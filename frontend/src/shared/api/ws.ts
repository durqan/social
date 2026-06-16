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

const reconnectDelayMs = 3000;
const callEventQueueTtlMs = 30000;
const callEventTypes: ReadonlySet<string> = new Set([
    WS_EVENTS.CALL_OFFER,
    WS_EVENTS.CALL_ANSWER,
    WS_EVENTS.CALL_ICE,
    WS_EVENTS.CALL_END,
    WS_EVENTS.CALL_REJECT,
]);

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
            this.opening = false;
            this.shouldReconnect = true;
            this.syncActiveConversation();
            this.flushPendingEvents();
        };
        this.ws.onmessage = event => {
            const parsed = this.parseMessage(event.data);

            if (parsed) {
                this.handlers.forEach(handler => handler(parsed));
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
            offer,
        });
    }

    sendCallAnswer(toId: number, answer: RTCSessionDescriptionInit, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_ANSWER, toId, {
            answer,
            call_id: callId,
        });
    }

    sendCallIce(toId: number, candidate: RTCIceCandidateInit, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_ICE, toId, {
            candidate,
            call_id: callId,
        });
    }

    sendCallEnd(toId: number, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_END, toId, { call_id: callId });
    }

    sendCallReject(toId: number, callId: string) {
        this.sendEventToUser(WS_EVENTS.CALL_REJECT, toId, { call_id: callId });
    }

    discardPendingCallEvents(callId?: string) {
        this.pendingEvents = this.pendingEvents.filter(event => {
            if (!isCallEvent(event)) {
                return true;
            }

            return callId ? getEventCallId(event) !== callId : false;
        });
    }

    disconnect() {
        if (this.activeConversationId !== null) {
            this.clearActiveConversation();
        }
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.pendingEvents = [];
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
            this.ws.send(JSON.stringify(event));
            return;
        }

        if (!queueIfClosed) {
            return;
        }

        this.pendingEvents.push({
            ...event,
            queuedAt: Date.now(),
        });
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

    private scheduleReconnect() {
        if (!this.shouldReconnect) {
            return;
        }

        this.reconnectTimer = window.setTimeout(() => {
            this.reconnectTimer = null;

            if (this.shouldReconnect) {
                this.connect();
            }
        }, reconnectDelayMs);
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
        const events = this.pendingEvents.splice(0).filter(event => (
            !isCallEvent(event) || now - event.queuedAt <= callEventQueueTtlMs
        ));

        events.forEach(({ queuedAt: _queuedAt, ...event }) => {
            this.ws?.send(JSON.stringify(event));
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
