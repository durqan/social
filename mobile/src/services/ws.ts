import { API_BASE_URL } from '../config/api';
import { tokenStore } from '../api/client';
import type { WsEvent } from '../types';

type WsHandler = (event: WsEvent) => void;

class MobileWebSocketService {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  private parse(raw: string): WsEvent | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed?.type || !parsed?.payload) return null;
      return parsed as WsEvent;
    } catch {
      return null;
    }
  }

  async connect() {
    this.shouldReconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const token = await tokenStore.get();
    if (!token) return;

    const wsURL = `${API_BASE_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(wsURL);

    this.ws.onmessage = event => {
      const parsed = this.parse(String(event.data));
      if (!parsed) return;
      this.handlers.forEach(handler => handler(parsed));
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.shouldReconnect) return;

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect().catch(() => undefined);
      }, 3000);
    };

    this.ws.onerror = () => undefined;
  }

  disconnect() {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.ws?.close();
    this.ws = null;
  }

  onMessage(handler: WsHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

export const wsService = new MobileWebSocketService();
