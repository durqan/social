import { WS_URL } from '../config/env';
import { getCookieHeader, refreshSession } from './http';
import type { Message, MessageAttachment } from './types';

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
      type: string;
      payload: unknown;
    };

type WsHandler = (event: WsEvent) => void;
type StatusHandler = (connected: boolean) => void;
type RNWebSocketConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: {
    headers?: Record<string, string>;
  },
) => WebSocket;

class ChatSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private opening = false;
  private connected = false;

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
    if (
      this.opening ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.open().catch(() => undefined);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
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
        this.setConnected(true);
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

  private sendEvent(event: { type: string; payload: unknown }) {
    if (!this.isConnected()) {
      throw new Error('WebSocket is not connected');
    }

    this.ws?.send(JSON.stringify(event));
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
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this.connect();
      }
    }, 3000);
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
