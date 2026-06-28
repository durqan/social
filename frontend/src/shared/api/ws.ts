import { request } from "@/shared/api/axios.js";
import type { MessageAttachment } from "@/shared/types/domain.js";
import type { CallType } from "@/features/call/types.js";
import type { WsEvent } from "@/shared/types/ws.js";
import type { EncryptedMessagePayload } from "@/crypto/encryptMessage.js";
import { WS_EVENTS } from '@social/shared';

type WsHandler = (event: WsEvent) => void;
type OutgoingEvent = {
    type: string;
    payload: unknown;
};
type QueuedEvent = OutgoingEvent & {
    queuedAt: number;
};

const reconnectBaseDelayMs = 1000;
const reconnectMaxDelayMs = 30000;

const callEventQueueTtlMs = 30000;
const defaultEventQueueTtlMs = 10 * 60 * 1000;
const readReceiptQueueTtlMs = 5 * 60 * 1000;
const ephemeralQueueTtlMs = 15000;
const presenceQueueTtlMs = 30000;
const maxPendingNonCallEvents = 50;
const callEventTypes: ReadonlySet<string> = new Set([
    WS_EVENTS.CALL_OFFER,
    WS_EVENTS.CALL_ANSWER,
    WS_EVENTS.CALL_ICE,
    WS_EVENTS.CALL_END,
    WS_EVENTS.CALL_REJECT,
    WS_EVENTS.CALL_HEARTBEAT,
    WS_EVENTS.CALL_TIMEOUT,
    WS_EVENTS.CALL_BUSY,
    WS_EVENTS.CALL_REPLACED,
]);

function createEventId(type: string, callId: string) {
    const nonce = globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${type}:${callId}:${nonce}`;
}

function attachmentForTransport(attachment: MessageAttachment): MessageAttachment {
    return {
        id: attachment.id,
        attachment_id: attachment.attachment_id,
        message_id: attachment.message_id,
        file_url: attachment.file_url,
        file_type: attachment.file_type,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration,
        duration_seconds: attachment.duration_seconds,
        size: attachment.size,
        original_filename: attachment.original_filename,
        content_type: attachment.content_type,
        encryption_version: attachment.encryption_version,
        encrypted_file_key: attachment.encrypted_file_key,
        file_nonce: attachment.file_nonce,
        encrypted_metadata: attachment.encrypted_metadata,
        created_at: attachment.created_at,
    };
}

function websocketURL() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
}

export class WebSocketService {
    private ws: WebSocket | null = null;
    private handlers = new Set<WsHandler>();
    private shouldReconnect = true;
    private reconnectTimer: number | null = null;
    private pendingEvents: QueuedEvent[] = [];
    private opening = false;
    private activeConversationId: number | null = null;
    private hasConnected = false;
    private reconnectAttempts = 0;
    private callEventSeq = new Map<string, number>();

    connect() {
        this.shouldReconnect = true;
        this.clearReconnectTimer();

        if (
            this.ws?.readyState === WebSocket.OPEN ||
            this.ws?.readyState === WebSocket.CONNECTING ||
            this.opening
        ) {
            return;
        }

        void this.openConnection();
    }

    private async openConnection() {
        this.opening = true;
        try {
            await request.post('/auth/refresh');
        } catch {
            this.opening = false;
            this.scheduleReconnect();
            return;
        }

        if (!this.shouldReconnect) {
            this.opening = false;
            return;
        }

        this.ws = new WebSocket(websocketURL());
        this.ws.onopen = () => {
            const reconnected = this.hasConnected;
            this.hasConnected = true;
            this.reconnectAttempts = 0;
            this.opening = false;
            this.shouldReconnect = true;
            this.syncActiveConversation();
            this.flushPendingEvents();
            window.dispatchEvent(new CustomEvent('websocket:open', {
                detail: { reconnected },
            }));
        };
        this.ws.onmessage = event => {
            const parsed = this.parseMessage(event.data);

            if (parsed) {
                this.handlers.forEach(handler => {
                    try {
                        handler(parsed);
                    } catch (error) {
                        console.error('WebSocket handler failed:', error);
                    }
                });
            }
        };
        this.ws.onclose = () => {
            this.opening = false;
            this.ws = null;
            this.scheduleReconnect();
        };
        this.ws.onerror = error => {
            console.error('WebSocket error:', error);
        };
        this.opening = false;
    }

    onMessage(handler: WsHandler) {
        this.handlers.add(handler);
    }

    removeMessageHandler(handler: WsHandler) {
        this.handlers.delete(handler);
    }

    send(toId: number, content: string, attachments: MessageAttachment[] = [], replyToMessageId?: number, encryption?: EncryptedMessagePayload) {
        this.sendEvent({
            type: WS_EVENTS.MESSAGE_SEND,
            payload: {
                to_id: toId,
                content,
                attachments: attachments.map(attachmentForTransport),
                replyToMessageId,
                ...(encryption || {}),
            },
        });
    }

    sendTypingStart(toId: number) {
        this.sendEventToUser(WS_EVENTS.TYPING_START, toId, {}, false);
    }

    sendTypingStop(toId: number) {
        this.sendEventToUser(WS_EVENTS.TYPING_STOP, toId, {}, false);
    }

    sendReadReceipt(toId: number) {
        this.sendEventToUser(WS_EVENTS.MESSAGE_READ, toId);
    }

    setActiveConversation(conversationId: number) {
        this.activeConversationId = conversationId;
        this.syncActiveConversation();
    }

    clearActiveConversation() {
        this.activeConversationId = null;
        this.sendEvent({
            type: WS_EVENTS.CONVERSATION_INACTIVE,
            payload: {},
        }, false);
    }

    sendCallOffer(
        toId: number,
        offer: RTCSessionDescriptionInit,
        callType: CallType,
        callId: string,
    ) {
        this.sendEventToUser(WS_EVENTS.CALL_OFFER, toId, {
            call_id: callId,
            call_type: callType,
            ...this.callEventMetadata(WS_EVENTS.CALL_OFFER, callId),
            offer,
        });
    }

    sendCallAnswer(toId: number, answer: RTCSessionDescriptionInit, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_ANSWER, toId, {
            answer,
            call_id: callId,
            ...this.callEventMetadata(WS_EVENTS.CALL_ANSWER, callId),
        });
    }

    sendCallIce(toId: number, candidate: RTCIceCandidateInit, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_ICE, toId, {
            candidate,
            call_id: callId,
            ...this.callEventMetadata(WS_EVENTS.CALL_ICE, callId),
        });
    }

    sendCallEnd(toId: number, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_END, toId, {
            call_id: callId,
            ...this.callEventMetadata(WS_EVENTS.CALL_END, callId),
        });
        this.callEventSeq.delete(callId);
    }

    sendCallReject(toId: number, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_REJECT, toId, {
            call_id: callId,
            ...this.callEventMetadata(WS_EVENTS.CALL_REJECT, callId),
        });
        this.callEventSeq.delete(callId);
    }

    sendCallHeartbeat(toId: number, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_HEARTBEAT, toId, {
            call_id: callId,
        });
    }

    discardPendingCallEvents(callId?: string) {
        this.pendingEvents = this.pendingEvents.filter(event => {
            if (!isCallEvent(event)) {
                return true;
            }

            return callId ? getEventCallId(event) !== callId : false;
        });
        if (callId) {
            this.callEventSeq.delete(callId);
        } else {
            this.callEventSeq.clear();
        }
    }

    disconnect() {
        if (this.activeConversationId !== null) {
            this.clearActiveConversation();
        }
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.pendingEvents = [];
        this.hasConnected = false;
        this.reconnectAttempts = 0;
        this.callEventSeq.clear();
        this.ws?.close();
        this.ws = null;
    }

    private syncActiveConversation() {
        if (!this.activeConversationId) {
            return;
        }

        this.sendEvent({
            type: WS_EVENTS.CONVERSATION_ACTIVE,
            payload: {
                conversation_id: this.activeConversationId,
            },
        }, false);
    }

    private parseMessage(raw: string): WsEvent | null {
        try {
            const parsed = JSON.parse(raw) as Partial<WsEvent>;

            if (!parsed || typeof parsed.type !== 'string' || !('payload' in parsed)) {
                return null;
            }

            return parsed as WsEvent;
        } catch {
            return null;
        }
    }

    private sendEvent(event: OutgoingEvent, queueIfClosed = true) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(event));
                return;
            } catch (error) {
                console.warn('WebSocket send failed:', error);
            }
        }

        if (!queueIfClosed) {
            return;
        }

        this.queuePendingEvent(event);
        this.connect();
    }

    private sendEventToUser(
        type: string,
        toId: number,
        payload: Record<string, unknown> = {},
        queueIfClosed = true,
    ) {
        this.sendEvent({
            type,
            payload: {
                to_id: toId,
                ...payload,
            },
        }, queueIfClosed);
    }

    private nextCallEventSeq(callId: string) {
        const next = (this.callEventSeq.get(callId) ?? 0) + 1;
        this.callEventSeq.set(callId, next);
        return next;
    }

    private callEventMetadata(type: string, callId: string) {
        return {
            event_id: createEventId(type, callId),
            event_seq: this.nextCallEventSeq(callId),
        };
    }

    private scheduleReconnect() {
        if (!this.shouldReconnect) {
            return;
        }

        const exp = Math.min(
            reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
            reconnectMaxDelayMs,
        );
        const jitter = Math.random() * 1000 - 500; // ±500ms
        const delay = Math.max(reconnectBaseDelayMs, exp + jitter);
        this.reconnectAttempts++;

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private flushPendingEvents() {
        if (this.ws?.readyState !== WebSocket.OPEN || this.pendingEvents.length === 0) {
            return;
        }

        const now = Date.now();
        const events = this.pendingEvents.splice(0).filter(event => {
            const fresh = now - event.queuedAt <= eventQueueTtl(event);
            if (!fresh) {
                logPendingDrop(event, 'expired');
            }
            return fresh;
        });

        events.forEach(({ queuedAt, ...event }) => {
            void queuedAt;
            try {
                this.ws?.send(JSON.stringify(event));
            } catch (error) {
                console.warn('WebSocket queued send failed:', error);
                this.queuePendingEvent(event);
            }
        });
    }

    private queuePendingEvent(event: OutgoingEvent) {
        this.dropExpiredPendingEvents();

        const dedupeKey = pendingDedupeKey(event);
        if (dedupeKey) {
            this.pendingEvents = this.pendingEvents.filter(queued => {
                const keep = pendingDedupeKey(queued) !== dedupeKey;
                if (!keep) {
                    logPendingDrop(queued, 'deduped');
                }
                return keep;
            });
        }

        this.pendingEvents.push({
            ...event,
            queuedAt: Date.now(),
        });
        this.enforcePendingQueueLimit();
    }

    private dropExpiredPendingEvents() {
        const now = Date.now();
        this.pendingEvents = this.pendingEvents.filter(event => {
            const fresh = now - event.queuedAt <= eventQueueTtl(event);
            if (!fresh) {
                logPendingDrop(event, 'expired');
            }
            return fresh;
        });
    }

    private enforcePendingQueueLimit() {
        const nonCallCount = this.pendingEvents.filter(event => !isCallEvent(event)).length;
        if (nonCallCount <= maxPendingNonCallEvents) {
            return;
        }

        let toDrop = nonCallCount - maxPendingNonCallEvents;
        this.pendingEvents = this.pendingEvents.filter(event => {
            if (toDrop <= 0 || isCallEvent(event)) {
                return true;
            }
            toDrop -= 1;
            logPendingDrop(event, 'queue_limit');
            return false;
        });
    }
}

function isCallEvent(event: OutgoingEvent) {
    return callEventTypes.has(event.type);
}

function getEventCallId(event: OutgoingEvent) {
    if (!event.payload || typeof event.payload !== 'object') {
        return null;
    }

    const callId = (event.payload as { call_id?: unknown }).call_id;
    return typeof callId === 'string' ? callId : null;
}

function eventQueueTtl(event: OutgoingEvent) {
    if (isCallEvent(event)) {
        return callEventQueueTtlMs;
    }
    if (event.type === WS_EVENTS.TYPING_START || event.type === WS_EVENTS.TYPING_STOP) {
        return ephemeralQueueTtlMs;
    }
    if (event.type === WS_EVENTS.CONVERSATION_ACTIVE || event.type === WS_EVENTS.CONVERSATION_INACTIVE) {
        return presenceQueueTtlMs;
    }
    if (event.type === WS_EVENTS.MESSAGE_READ) {
        return readReceiptQueueTtlMs;
    }
    return defaultEventQueueTtlMs;
}

function pendingDedupeKey(event: OutgoingEvent) {
    if (!event.payload || typeof event.payload !== 'object') {
        return null;
    }

    const payload = event.payload as Record<string, unknown>;
    if (event.type === WS_EVENTS.TYPING_START || event.type === WS_EVENTS.TYPING_STOP) {
        return `typing:${payload.to_id ?? 'unknown'}`;
    }
    if (event.type === WS_EVENTS.MESSAGE_READ) {
        return `read:${payload.to_id ?? payload.conversation_id ?? 'unknown'}`;
    }
    if (event.type === WS_EVENTS.CONVERSATION_ACTIVE || event.type === WS_EVENTS.CONVERSATION_INACTIVE) {
        return `conversation-presence:${payload.conversation_id ?? 'unknown'}`;
    }
    return null;
}

function logPendingDrop(event: OutgoingEvent, reason: string) {
    console.info('WebSocket pending event dropped:', {
        type: event.type,
        reason,
        callId: getEventCallId(event),
    });
}
