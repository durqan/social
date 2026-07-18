import type { AppStateStatus } from 'react-native';
import {
  WS_EVENTS,
  type CallType,
  type WsEvent,
} from './wsEvents';

import { WS_URL } from '../config/env';
import type { EncryptedMessagePayload } from '../crypto/encryptMessage';
import { ApiError, getCookieHeader, refreshSession } from './http';
import type { MessageAttachment } from './types';
import { logDev, warnDev } from '../utils/logger';
import {
  callError,
  callLog,
  callWarn,
  describeCallError,
  logCallEnvOnce,
  sanitizeEndpoint,
} from '../utils/callDiagnostics';

export { WS_EVENTS };
export type { CallType, WsEvent };

type WsHandler = (event: WsEvent) => void;
type StatusHandler = (connected: boolean) => void;
export type WsConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'auth_error';
type OutgoingEvent = { type: string; payload: unknown };
type QueuedEvent = OutgoingEvent & { queuedAt: number };
type RNWebSocketConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: {
    headers?: Record<string, string>;
  },
) => WebSocket;

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
  private readonly minReconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private readonly maxPendingNonCallEvents = 50;
  private readonly defaultNonCallEventQueueTtlMs = 10 * 60 * 1000;
  private readonly readReceiptQueueTtlMs = 5 * 60 * 1000;
  private readonly ephemeralQueueTtlMs = 15000;
  private readonly presenceQueueTtlMs = 30000;
  private ws: WebSocket | null = null;
  private socketGeneration = 0;
  private handlers = new Set<WsHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = false;
  private connectionStatus: WsConnectionStatus = 'disconnected';
  private networkOnline = true;
  private appState: AppStateStatus = 'unknown';
  private pendingEvents: QueuedEvent[] = [];
  private activeConversationId: number | null = null;
  private readonly callEventQueueTtlMs = 30000;
  private readonly callEventTypes: ReadonlySet<string> = new Set([
    WS_EVENTS.CALL_INCOMING,
    WS_EVENTS.CALL_ACCEPTED,
    WS_EVENTS.CALL_END,
    WS_EVENTS.CALL_REJECT,
    WS_EVENTS.CALL_HEARTBEAT,
  ]);

  setNetworkOnline(online: boolean) {
    if (this.networkOnline === online) {
      return;
    }

    this.networkOnline = online;
    if (!online) {
      this.clearReconnectTimer();
      this.closeCurrentSocket();
      this.setConnectionStatus('disconnected');
      return;
    }

    if (this.shouldReconnect) {
      this.recover();
    }
  }

  setAppState(nextState: AppStateStatus) {
    const previousState = this.appState;
    if (previousState === nextState) {
      return;
    }
    this.appState = nextState;

    if (nextState === 'active' && previousState !== 'active') {
      if (this.isConnected()) {
        this.syncActiveConversation();
      } else if (this.shouldReconnect) {
        this.recover();
      }
      return;
    }

    if (
      previousState === 'active' &&
      nextState !== 'active' &&
      this.activeConversationId !== null &&
      this.isConnected()
    ) {
      this.sendEvent(
        { type: WS_EVENTS.CONVERSATION_INACTIVE, payload: {} },
        false,
      );
    }
  }

  onMessage(handler: WsHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.isConnected());
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  isConnected() {
    return (
      this.connectionStatus === 'connected' &&
      this.ws?.readyState === WebSocket.OPEN
    );
  }

  connect() {
    logCallEnvOnce('ws_connect');
    this.shouldReconnect = true;
    if (!this.networkOnline) {
      callWarn('CALL_WS', 'connect skipped while network is offline');
      return;
    }
    if (
      this.connectionStatus === 'connecting' ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      callLog('CALL_WS', 'connect skipped while socket is already active', {
        status: this.connectionStatus,
        readyState: this.ws?.readyState,
        connected: this.isConnected(),
      });
      return;
    }

    this.open().catch(error => {
      callError('CALL_ERROR', 'websocket open promise rejected', {
        error: describeCallError(error),
      });
    });
  }

  recover() {
    logDev('[SocialMobile] WebSocket reconnect requested', {
      pendingEvents: this.pendingEvents.length,
      connected: this.isConnected(),
    });
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.connect();
  }

  waitUntilConnected(timeoutMs = 8000): Promise<boolean> {
    if (this.isConnected()) {
      return Promise.resolve(true);
    }

    this.connect();
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
    this.closeCurrentSocket();
    this.setConnectionStatus('disconnected');
  }

  sendMessage(
    toId: number,
    content: string,
    attachments: MessageAttachment[],
    replyToMessageId?: number | null,
    encryption?: EncryptedMessagePayload,
  ) {
    return this.sendEvent({
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

  sendCallHeartbeat(toId: number, callId: string) {
    return this.sendEvent({
      type: WS_EVENTS.CALL_HEARTBEAT,
      payload: {
        to_id: toId,
        call_id: callId,
      },
    });
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

  private async open() {
    const generation = this.socketGeneration + 1;
    this.socketGeneration = generation;
    this.setConnectionStatus(
      this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
    );
    callLog('CALL_WS', 'opening websocket', {
      generation,
      url: sanitizeEndpoint(WS_URL),
    });

    try {
      await refreshSession();
      if (!this.shouldReconnect || generation !== this.socketGeneration) {
        callWarn('CALL_WS', 'open aborted after auth refresh', {
          generation,
          shouldReconnect: this.shouldReconnect,
        });
        return;
      }
      const cookieHeader = await getCookieHeader();
      if (!this.shouldReconnect || generation !== this.socketGeneration) {
        callWarn('CALL_WS', 'open aborted after cookie read', {
          generation,
          shouldReconnect: this.shouldReconnect,
        });
        return;
      }
      const SocketCtor = WebSocket as unknown as RNWebSocketConstructor;

      const socket = new SocketCtor(WS_URL, undefined, {
        headers: cookieHeader
          ? {
              Cookie: cookieHeader,
            }
          : undefined,
      });
      if (!this.shouldReconnect || generation !== this.socketGeneration) {
        socket.close();
        callWarn('CALL_WS', 'open aborted after socket creation', {
          generation,
          shouldReconnect: this.shouldReconnect,
        });
        return;
      }

      this.ws = socket;

      socket.onopen = () => {
        if (!this.isCurrentSocket(socket, generation)) {
          socket.close();
          return;
        }
        const reconnectAttempt = this.reconnectAttempts;
        this.reconnectAttempts = 0;
        this.setConnectionStatus('connected');
        callLog('CALL_WS', 'websocket connected', {
          generation,
          pendingEvents: this.pendingEvents.length,
          reconnectAttempt,
        });
        logDev(
          reconnectAttempt > 0
            ? '[SocialMobile] WebSocket reconnect complete'
            : '[SocialMobile] WebSocket connected',
          {
            generation,
            pendingEvents: this.pendingEvents.length,
            reconnectAttempt,
          },
        );
        this.syncActiveConversation();
        this.flushPendingEvents();
      };
      socket.onmessage = event => {
        if (this.isCurrentSocket(socket, generation)) {
          this.handleRawMessage(event.data);
        }
      };
      socket.onerror = () => {
        if (!this.isCurrentSocket(socket, generation)) {
          return;
        }
        callError('CALL_ERROR', 'websocket error', { generation });
        warnDev('[SocialMobile] WebSocket error', { generation });
        this.setConnectionStatus('disconnected');
        socket.close();
      };
      socket.onclose = () => {
        if (!this.isCurrentSocket(socket, generation)) {
          return;
        }
        callLog('CALL_WS', 'websocket closed', {
          generation,
          shouldReconnect: this.shouldReconnect,
          pendingEvents: this.pendingEvents.length,
        });
        logDev('[SocialMobile] WebSocket closed', {
          generation,
          shouldReconnect: this.shouldReconnect,
          pendingEvents: this.pendingEvents.length,
        });
        this.ws = null;
        this.setConnectionStatus('disconnected');
        this.scheduleReconnect();
      };
    } catch (error) {
      if (generation !== this.socketGeneration) {
        return;
      }
      callError('CALL_ERROR', 'websocket open failed', {
        generation,
        error: describeCallError(error),
      });
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        this.setConnectionStatus('auth_error');
        return;
      }
      this.setConnectionStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  private sendEvent(event: OutgoingEvent, queueIfClosed = true) {
    if (!this.isConnected()) {
      if (!queueIfClosed) {
        if (this.isCallEvent(event)) {
          callWarn('CALL_WS', 'call event dropped because socket is closed', {
            type: event.type,
            callId: this.eventCallId(event),
            connected: this.isConnected(),
          });
        }
        return false;
      }

      this.queuePendingEvent(event);
      this.logSocketSend(event, 'queued');
      this.connect();
      return false;
    }

    try {
      this.ws?.send(JSON.stringify(event));
      this.logSocketSend(event, 'sent');
      return true;
    } catch (error) {
      callError('CALL_ERROR', 'websocket send failed', {
        type: event.type,
        callId: this.eventCallId(event),
        error: describeCallError(error),
      });
      warnDev('[SocialMobile] WebSocket send failed', {
        type: event.type,
        callId: this.eventCallId(event),
        error,
      });
      if (queueIfClosed) {
        this.queuePendingEvent(event);
      }
      this.connect();
      return false;
    }
  }

  private logSocketSend(event: OutgoingEvent, mode: 'sent' | 'queued') {
    if (!this.isCallEvent(event)) {
      return;
    }

    logDev('[SocialMobile] Call lifecycle event ' + mode, {
      type: event.type,
      callId: this.eventCallId(event),
      connected: this.isConnected(),
      pendingEvents: this.pendingEvents.length,
    });
    callLog('CALL_WS', `call lifecycle event ${mode}`, {
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
      const fresh = now - event.queuedAt <= this.eventQueueTtl(event);
      if (!fresh) {
        this.logPendingDrop(event, 'expired');
      }
      return fresh;
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
        if (this.callEventTypes.has(parsed.type)) {
          callLog('CALL_WS', 'call lifecycle event received', {
            type: parsed.type,
            callId:
              parsed.payload && typeof parsed.payload === 'object'
                ? (parsed.payload as { call_id?: unknown }).call_id
                : null,
            fromId:
              parsed.payload && typeof parsed.payload === 'object'
                ? (parsed.payload as { from_id?: unknown }).from_id
                : null,
          });
        }
        this.handlers.forEach(handler => {
          try {
            handler(parsed);
          } catch (error) {
            callError('CALL_ERROR', 'websocket handler failed', {
              type: parsed.type,
              error: describeCallError(error),
            });
            warnDev('[SocialMobile] WebSocket handler failed', {
              type: parsed.type,
              error,
            });
          }
        });
      }
    } catch (error) {
      callWarn('CALL_WS', 'malformed websocket event ignored', {
        error: describeCallError(error),
      });
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || !this.networkOnline || this.reconnectTimer) {
      return;
    }

    this.reconnectAttempts += 1;
    const baseDelay = Math.min(
      this.maxReconnectDelay,
      this.minReconnectDelay * 2 ** (this.reconnectAttempts - 1),
    );
    const jitter = baseDelay * 0.2;
    const delay = Math.min(
      this.maxReconnectDelay,
      Math.round(baseDelay - jitter + Math.random() * jitter * 2),
    );
    this.setConnectionStatus('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        callLog('CALL_WS', 'websocket reconnecting', {
          attempt: this.reconnectAttempts,
          pendingEvents: this.pendingEvents.length,
        });
        logDev('[SocialMobile] WebSocket reconnecting', {
          attempt: this.reconnectAttempts,
          pendingEvents: this.pendingEvents.length,
        });
        this.connect();
      }
    }, delay);

    callLog('CALL_WS', 'websocket reconnect scheduled', {
      attempt: this.reconnectAttempts,
      delay,
      pendingEvents: this.pendingEvents.length,
    });
    logDev('[SocialMobile] WebSocket reconnect scheduled', {
      attempt: this.reconnectAttempts,
      delay,
      pendingEvents: this.pendingEvents.length,
    });
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnectionStatus(nextStatus: WsConnectionStatus) {
    if (this.connectionStatus === nextStatus) {
      return;
    }

    const wasConnected = this.connectionStatus === 'connected';
    this.connectionStatus = nextStatus;
    const connected = nextStatus === 'connected';
    if (wasConnected !== connected) {
      this.statusHandlers.forEach(handler => handler(connected));
    }
  }

  private closeCurrentSocket() {
    this.socketGeneration += 1;
    const socket = this.ws;
    this.ws = null;
    socket?.close();
  }

  private isCallEvent(event: OutgoingEvent) {
    return this.callEventTypes.has(event.type);
  }

  private queuePendingEvent(event: OutgoingEvent) {
    this.dropExpiredPendingEvents();

    const dedupeKey = this.pendingDedupeKey(event);
    if (dedupeKey) {
      this.pendingEvents = this.pendingEvents.filter(queued => {
        const keep = this.pendingDedupeKey(queued) !== dedupeKey;
        if (!keep) {
          this.logPendingDrop(queued, 'deduped');
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
      const fresh = now - event.queuedAt <= this.eventQueueTtl(event);
      if (!fresh) {
        this.logPendingDrop(event, 'expired');
      }
      return fresh;
    });
  }

  private enforcePendingQueueLimit() {
    const nonCallCount = this.pendingEvents.filter(
      event => !this.isCallEvent(event),
    ).length;
    if (nonCallCount <= this.maxPendingNonCallEvents) {
      return;
    }

    let toDrop = nonCallCount - this.maxPendingNonCallEvents;
    this.pendingEvents = this.pendingEvents.filter(event => {
      if (toDrop <= 0 || this.isCallEvent(event)) {
        return true;
      }
      toDrop -= 1;
      this.logPendingDrop(event, 'queue_limit');
      return false;
    });
  }

  private eventQueueTtl(event: OutgoingEvent) {
    if (this.isCallEvent(event)) {
      return this.callEventQueueTtlMs;
    }
    if (
      event.type === WS_EVENTS.TYPING_START ||
      event.type === WS_EVENTS.TYPING_STOP
    ) {
      return this.ephemeralQueueTtlMs;
    }
    if (
      event.type === WS_EVENTS.CONVERSATION_ACTIVE ||
      event.type === WS_EVENTS.CONVERSATION_INACTIVE
    ) {
      return this.presenceQueueTtlMs;
    }
    if (event.type === WS_EVENTS.MESSAGE_READ) {
      return this.readReceiptQueueTtlMs;
    }
    return this.defaultNonCallEventQueueTtlMs;
  }

  private pendingDedupeKey(event: OutgoingEvent) {
    if (!event.payload || typeof event.payload !== 'object') {
      return null;
    }

    const payload = event.payload as Record<string, unknown>;
    if (
      event.type === WS_EVENTS.TYPING_START ||
      event.type === WS_EVENTS.TYPING_STOP
    ) {
      return `typing:${payload.to_id ?? 'unknown'}`;
    }
    if (event.type === WS_EVENTS.MESSAGE_READ) {
      return `read:${payload.to_id ?? payload.conversation_id ?? 'unknown'}`;
    }
    if (
      event.type === WS_EVENTS.CONVERSATION_ACTIVE ||
      event.type === WS_EVENTS.CONVERSATION_INACTIVE
    ) {
      return `conversation-presence:${payload.conversation_id ?? 'unknown'}`;
    }
    return null;
  }

  private logPendingDrop(event: OutgoingEvent, reason: string) {
    logDev('[SocialMobile] WebSocket pending event dropped', {
      type: event.type,
      reason,
      callId: this.eventCallId(event),
      pendingEvents: this.pendingEvents.length,
    });
    if (this.isCallEvent(event)) {
      callWarn('CALL_WS', 'pending call event dropped', {
        type: event.type,
        reason,
        callId: this.eventCallId(event),
        pendingEvents: this.pendingEvents.length,
      });
    }
  }

  private eventCallId(event: OutgoingEvent) {
    if (!event.payload || typeof event.payload !== 'object') {
      return null;
    }

    const callId = (event.payload as { call_id?: unknown }).call_id;
    return typeof callId === 'string' ? callId : null;
  }

  private isCurrentSocket(socket: WebSocket, generation: number) {
    return this.ws === socket && this.socketGeneration === generation;
  }
}

export const chatSocket = new ChatSocket();
