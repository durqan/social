import NetInfo from '@react-native-community/netinfo';
import {
  WS_EVENTS,
  type CallIceCandidate,
  type CallSessionDescription,
  type CallType,
  type WsEvent,
} from '@social/shared';

import { WS_URL } from '../config/env';
import type { EncryptedMessagePayload } from '../crypto/encryptMessage';
import { getCookieHeader, refreshSession } from './http';
import type { MessageAttachment } from './types';
import { logDev, warnDev } from '../utils/logger';

export type { CallIceCandidate, CallSessionDescription, CallType, WsEvent };

type WsHandler = (event: WsEvent) => void;
type StatusHandler = (connected: boolean) => void;
type OutgoingEvent = { type: string; payload: unknown };
type QueuedEvent = OutgoingEvent & { queuedAt: number };
type RNWebSocketConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: {
    headers?: Record<string, string>;
  },
) => WebSocket;

function createEventId(type: string, callId?: string) {
  return `${type}:${callId ?? 'event'}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function attachmentForTransport(
  attachment: MessageAttachment,
): MessageAttachment {
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

class ChatSocket {
  private readonly maxReconnectAttempts = 8;
  private readonly minReconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private ws: WebSocket | null = null;
  private handlers = new Set<WsHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private opening = false;
  private connected = false;
  private networkOnline = true;
  private pendingEvents: QueuedEvent[] = [];
  private activeConversationId: number | null = null;
  private callEventSeq = new Map<string, number>();
  private readonly callEventQueueTtlMs = 30000;
  private readonly callEventTypes: ReadonlySet<string> = new Set([
    WS_EVENTS.CALL_OFFER,
    WS_EVENTS.CALL_ANSWER,
    WS_EVENTS.CALL_ICE,
    WS_EVENTS.CALL_END,
    WS_EVENTS.CALL_REJECT,
  ]);

  constructor() {
    NetInfo.addEventListener(state => {
      const online =
        state.isConnected !== false && state.isInternetReachable !== false;

      if (this.networkOnline === online) {
        return;
      }

      this.networkOnline = online;
      if (!online) {
        this.clearReconnectTimer();
        this.setConnected(false);
        return;
      }

      if (this.shouldReconnect) {
        this.recover();
      }
    });
  }

  onMessage(handler: WsHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.connected);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.shouldReconnect = true;
    if (!this.networkOnline) {
      return;
    }
    if (
      this.opening ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.open().catch(() => undefined);
  }

  recover() {
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.connect();
  }

  waitUntilConnected(timeoutMs = 8000): Promise<boolean> {
    if (this.isConnected()) {
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;

      const finish = (connected: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        unsubscribe?.();
        resolve(connected);
      };

      const timeout = setTimeout(() => {
        finish(false);
      }, timeoutMs);

      unsubscribe = this.onStatus(connected => {
        if (connected) {
          finish(true);
        }
      });
    });
  }

  disconnect() {
    if (this.activeConversationId !== null) {
      this.clearActiveConversation();
    }
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.pendingEvents = [];
    this.setConnected(false);
    this.ws?.close();
    this.ws = null;
  }

  sendMessage(
    toId: number,
    content: string,
    attachments: MessageAttachment[],
    replyToMessageId?: number | null,
    encryption?: EncryptedMessagePayload,
  ) {
    this.sendEvent({
      type: WS_EVENTS.MESSAGE_SEND,
      payload: {
        to_id: toId,
        content,
        attachments: attachments.map(attachmentForTransport),
        replyToMessageId: replyToMessageId ?? null,
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
    this.sendEvent(
      {
        type: WS_EVENTS.CONVERSATION_INACTIVE,
        payload: {},
      },
      false,
    );
  }

  sendCallOffer(
    toId: number,
    offer: CallSessionDescription,
    callType: CallType,
    callId: string,
  ) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_OFFER,
      payload: {
        to_id: toId,
        offer,
        call_type: callType,
        call_id: callId,
        event_id: createEventId(WS_EVENTS.CALL_OFFER, callId),
        event_seq: this.nextCallEventSeq(callId),
      },
    });
  }

  sendCallAnswer(toId: number, answer: CallSessionDescription, callId: string) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_ANSWER,
      payload: {
        to_id: toId,
        answer,
        call_id: callId,
        event_id: createEventId(WS_EVENTS.CALL_ANSWER, callId),
        event_seq: this.nextCallEventSeq(callId),
      },
    });
  }

  sendCallIce(toId: number, candidate: CallIceCandidate, callId: string) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_ICE,
      payload: {
        to_id: toId,
        candidate,
        call_id: callId,
        event_id: createEventId(WS_EVENTS.CALL_ICE, callId),
        event_seq: this.nextCallEventSeq(callId),
      },
    });
  }

  sendCallEnd(toId: number, callId: string) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_END,
      payload: {
        to_id: toId,
        call_id: callId,
        event_id: createEventId(WS_EVENTS.CALL_END, callId),
        event_seq: this.nextCallEventSeq(callId),
      },
    });
    this.callEventSeq.delete(callId);
  }

  sendCallReject(toId: number, callId: string) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_REJECT,
      payload: {
        to_id: toId,
        call_id: callId,
        event_id: createEventId(WS_EVENTS.CALL_REJECT, callId),
        event_seq: this.nextCallEventSeq(callId),
      },
    });
    this.callEventSeq.delete(callId);
  }

  private sendEventToUser(
    type: string,
    toId: number,
    payload: Record<string, unknown> = {},
    queueIfClosed = true,
  ) {
    this.sendEvent(
      {
        type,
        payload: {
          to_id: toId,
          ...payload,
        },
      },
      queueIfClosed,
    );
  }

  discardPendingCallEvents(callId?: string) {
    this.pendingEvents = this.pendingEvents.filter(event => {
      if (!this.isCallEvent(event)) {
        return true;
      }

      return callId ? this.eventCallId(event) !== callId : false;
    });
  }

  private async open() {
    this.opening = true;

    try {
      await refreshSession();
      const cookieHeader = await getCookieHeader();
      const SocketCtor = WebSocket as unknown as RNWebSocketConstructor;

      this.ws = new SocketCtor(WS_URL, undefined, {
        headers: cookieHeader
          ? {
              Cookie: cookieHeader,
            }
          : undefined,
      });

      this.ws.onopen = () => {
        this.opening = false;
        this.reconnectAttempts = 0;
        this.setConnected(true);
        this.syncActiveConversation();
        this.flushPendingEvents();
      };
      this.ws.onmessage = event => this.handleRawMessage(event.data);
      this.ws.onerror = () => {
        this.opening = false;
        this.setConnected(false);
      };
      this.ws.onclose = () => {
        this.opening = false;
        this.ws = null;
        this.setConnected(false);
        this.scheduleReconnect();
      };
    } catch {
      this.opening = false;
      this.setConnected(false);
      this.scheduleReconnect();
    }
  }

  private sendEvent(event: OutgoingEvent, queueIfClosed = true) {
    if (!this.isConnected()) {
      if (!queueIfClosed) {
        return false;
      }

      this.pendingEvents.push({
        ...event,
        queuedAt: Date.now(),
      });
      this.logSocketSend(event, 'queued');
      this.connect();
      return false;
    }

    try {
      this.ws?.send(JSON.stringify(event));
      this.logSocketSend(event, 'sent');
      return true;
    } catch (error) {
      warnDev('[SocialMobile] WebSocket send failed', {
        type: event.type,
        callId: this.eventCallId(event),
        error,
      });
      if (queueIfClosed) {
        this.pendingEvents.push({
          ...event,
          queuedAt: Date.now(),
        });
      }
      this.connect();
      return false;
    }
  }

  private logSocketSend(event: OutgoingEvent, mode: 'sent' | 'queued') {
    if (!this.isCallEvent(event)) {
      return;
    }

    logDev('[SocialMobile] Call signaling event ' + mode, {
      type: event.type,
      callId: this.eventCallId(event),
      connected: this.isConnected(),
      pendingEvents: this.pendingEvents.length,
    });
  }

  private syncActiveConversation() {
    if (!this.activeConversationId) {
      return;
    }

    this.sendEvent(
      {
        type: WS_EVENTS.CONVERSATION_ACTIVE,
        payload: {
          conversation_id: this.activeConversationId,
        },
      },
      false,
    );
  }

  private flushPendingEvents() {
    if (!this.isConnected() || this.pendingEvents.length === 0) {
      return;
    }

    const now = Date.now();
    const events = this.pendingEvents.splice(0).filter(event => {
      return (
        !this.isCallEvent(event) ||
        now - event.queuedAt <= this.callEventQueueTtlMs
      );
    });

    events.forEach(({ queuedAt: _queuedAt, ...event }) => {
      this.ws?.send(JSON.stringify(event));
      this.logSocketSend(event, 'sent');
    });
  }

  private handleRawMessage(raw: WebSocketMessageEvent['data']) {
    if (typeof raw !== 'string') {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as WsEvent;
      if (parsed && typeof parsed.type === 'string') {
        this.handlers.forEach(handler => handler(parsed));
      }
    } catch {
      // Ignore malformed events from the socket.
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this.networkOnline || this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logDev('[SocialMobile] WebSocket reconnect paused after max attempts');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.maxReconnectDelay,
      this.minReconnectDelay * 2 ** (this.reconnectAttempts - 1),
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnected(nextConnected: boolean) {
    if (this.connected === nextConnected) {
      return;
    }

    this.connected = nextConnected;
    this.statusHandlers.forEach(handler => handler(nextConnected));
  }

  private isCallEvent(event: OutgoingEvent) {
    return this.callEventTypes.has(event.type);
  }

  private eventCallId(event: OutgoingEvent) {
    if (!event.payload || typeof event.payload !== 'object') {
      return null;
    }

    const callId = (event.payload as { call_id?: unknown }).call_id;
    return typeof callId === 'string' ? callId : null;
  }

  private nextCallEventSeq(callId: string) {
    const next = (this.callEventSeq.get(callId) ?? 0) + 1;
    this.callEventSeq.set(callId, next);
    return next;
  }
}

export const chatSocket = new ChatSocket();
