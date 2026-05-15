import type { WsEvent } from '../types/ws/events.js';

export class WebSocketService {

    private ws: WebSocket | null = null;

    private handlers: ((event: WsEvent) => void)[] = [];

    private shouldReconnect = true;

    // =========================
    // PARSE MESSAGE
    // =========================

    private parseMessage(raw: string): WsEvent | null {

        try {

            const parsed = JSON.parse(raw);

            if (!parsed.type || !parsed.payload) {
                return null;
            }

            return parsed as WsEvent;

        } catch {

            return null;
        }
    }

    // =========================
    // SEND EVENT
    // =========================

    private sendEvent(event: unknown) {

        if (this.ws?.readyState !== WebSocket.OPEN) {
            return;
        }

        this.ws.send(JSON.stringify(event));
    }

    // =========================
    // CONNECT
    // =========================

    connect() {

        if (
            this.ws?.readyState === WebSocket.OPEN ||
            this.ws?.readyState === WebSocket.CONNECTING
        ) {
            return;
        }

        const protocol =
            window.location.protocol === 'https:'
                ? 'wss:'
                : 'ws:';

        this.ws = new WebSocket(
            `${protocol}//${window.location.host}/ws`
        );

        this.ws.onopen = () => {
            this.shouldReconnect = true;
        };

        this.ws.onmessage = (event) => {

            const parsed = this.parseMessage(event.data);

            if (!parsed) return;

            this.handlers.forEach(handler =>
                handler(parsed)
            );
        };

        this.ws.onclose = () => {

            this.ws = null;

            if (this.shouldReconnect) {

                setTimeout(() => {
                    this.connect();
                }, 3000);
            }
        };

        this.ws.onerror = (error) => {
            console.error(
                'WebSocket error:',
                error
            );
        };
    }

    // =========================
    // SUBSCRIBE
    // =========================

    onMessage(
        handler: (event: WsEvent) => void
    ) {
        this.handlers.push(handler);
    }

    removeMessageHandler(
        handler: (event: WsEvent) => void
    ) {

        const index =
            this.handlers.indexOf(handler);

        if (index !== -1) {
            this.handlers.splice(index, 1);
        }
    }

    // =========================
    // SEND MESSAGE
    // =========================

    send(toId: number, content: string) {

        this.sendEvent({
            type: 'message:send',

            payload: {
                to_id: toId,
                content,
            },
        });
    }

    // =========================
    // TYPING START
    // =========================

    sendTypingStart(toId: number) {

        this.sendEvent({
            type: 'typing:start',

            payload: {
                to_id: toId,
            },
        });
    }

    // =========================
    // TYPING STOP
    // =========================

    sendTypingStop(toId: number) {

        this.sendEvent({
            type: 'typing:stop',

            payload: {
                to_id: toId,
            },
        });
    }

    // =========================
    // READ RECEIPT
    // =========================

    sendReadReceipt(toId: number) {

        this.sendEvent({
            type: 'message:read',

            payload: {
                to_id: toId,
            },
        });
    }

    // =========================
    // DISCONNECT
    // =========================

    disconnect() {

        this.shouldReconnect = false;

        this.ws?.close();

        this.ws = null;
    }
}