import type { MessageAttachment } from '../types.js';
import type { WsEvent } from '../types/ws/events.js';

export class WebSocketService {

    private ws: WebSocket | null = null;
    private handlers: ((event: WsEvent) => void)[] = [];
    private shouldReconnect = true;
    private reconnectTimer: number | null = null;

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

        this.shouldReconnect = true;

        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

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

                this.reconnectTimer = window.setTimeout(() => {
                    this.reconnectTimer = null;

                    if (this.shouldReconnect) {
                        this.connect();
                    }
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
    send(
        toId: number,
        content: string,
        attachments: MessageAttachment[] = []
    ) {

        this.sendEvent({
            type: 'message:send',

            payload: {
                to_id: toId,
                content,
                attachments,
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
    // AUDIO CALL
    // =========================

    sendCallOffer(
        toId: number,
        offer: RTCSessionDescriptionInit,
        callType: 'audio' | 'video' = 'audio'
    ) {

        this.sendEvent({
            type: 'call:offer',

            payload: {
                to_id: toId,
                call_type: callType,
                offer,
            },
        });
    }

    sendCallAnswer(toId: number, answer: RTCSessionDescriptionInit) {

        this.sendEvent({
            type: 'call:answer',

            payload: {
                to_id: toId,
                answer,
            },
        });
    }

    sendCallIce(toId: number, candidate: RTCIceCandidateInit) {

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

    // =========================
    // DISCONNECT
    // =========================

    disconnect() {

        this.shouldReconnect = false;

        if (this.reconnectTimer) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.ws?.close();

        this.ws = null;
    }
}
