import NetInfo from '@react-native-community/netinfo';

import { WS_URL } from '../config/env';
import { getCookieHeader, refreshSession } from './http';
import type { Message, MessageAttachment } from './types';
import { logDev } from '../utils/logger';

export type CallType = 'audio' | 'video';

export type CallSessionDescription = {
  type: string | null;
  sdp: string;
};

export type CallIceCandidate = {
  candidate: string;
  sdpMLineIndex?: number | null;
  sdpMid?: string | null;
};

export type WsEvent =
  | {
      type: 'message:new';
      payload: Message;
    }
  | {
      type: 'message:error';
      payload: {
        error: string;
      };
    }
  | {
      type: 'message:read';
      payload: {
        from_id: number;
        to_id: number;
      };
    }
  | {
      type: 'typing:start' | 'typing:stop';
      payload: {
        from_id: number;
      };
    }
  | {
      type: 'call:offer';
      payload: {
        from_id: number;
        call_type?: CallType;
        offer: CallSessionDescription;
      };
    }
  | {
      type: 'call:answer';
      payload: {
        from_id: number;
        answer: CallSessionDescription;
      };
    }
  | {
      type: 'call:ice';
      payload: {
        from_id: number;
        candidate: CallIceCandidate;
      };
    }
  | {
      type: 'call:end' | 'call:reject';
      payload: {
        from_id: number;
      };
    }
  | {
      type: string;
      payload: unknown;
    };

type WsHandler = (event: WsEvent) => void;
type StatusHandler = (connected: boolean) => void;
type OutgoingEvent = { type: string; payload: unknown };
type RNWebSocketConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: {
    headers?: Record<string, string>;
  },
) => WebSocket;

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
  private pendingEvents: OutgoingEvent[] = [];

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
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.connected);
    return () => this.statusHandlers.delete(handler);
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

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.pendingEvents = [];
    this.setConnected(false);
    this.ws?.close();
    this.ws = null;
  }

  sendMessage(toId: number, content: string, attachments: MessageAttachment[]) {
    this.sendEvent({
      type: 'message:send',
      payload: {
        to_id: toId,
        content,
        attachments,
      },
    });
  }

  sendReadReceipt(toId: number) {
    this.sendEvent({
      type: 'message:read',
      payload: {
        to_id: toId,
      },
    });
  }

  sendCallOffer(
    toId: number,
    offer: CallSessionDescription,
    callType: CallType,
  ) {
    this.sendEvent({
      type: 'call:offer',
      payload: {
        to_id: toId,
        offer,
        call_type: callType,
      },
    });
  }

  sendCallAnswer(toId: number, answer: CallSessionDescription) {
    this.sendEvent({
      type: 'call:answer',
      payload: {
        to_id: toId,
        answer,
      },
    });
  }

  sendCallIce(toId: number, candidate: CallIceCandidate) {
    this.sendEvent({
      type: 'call:ice',
      payload: {
        to_id: toId,
        candidate,
      },
    });
  }

  sendCallEnd(toId: number) {
    this.sendEvent({
      type: 'call:end',
      payload: {
        to_id: toId,
      },
    });
  }

  sendCallReject(toId: number) {
    this.sendEvent({
      type: 'call:reject',
      payload: {
        to_id: toId,
      },
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

  private sendEvent(event: OutgoingEvent) {
    if (!this.isConnected()) {
      this.pendingEvents.push(event);
      this.connect();
      return;
    }

    this.ws?.send(JSON.stringify(event));
  }

  private flushPendingEvents() {
    if (!this.isConnected() || this.pendingEvents.length === 0) {
      return;
    }

    const events = this.pendingEvents.splice(0);
    events.forEach(event => {
      this.ws?.send(JSON.stringify(event));
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
}

export const chatSocket = new ChatSocket();
