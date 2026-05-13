class WebSocketService {
    private ws: WebSocket | null = null;
    private handlers: ((data: any) => void)[] = [];
    private shouldReconnect = true;

    connect() {
        if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

        this.ws.onopen = () => {
            console.log('✅ WebSocket connected');
            this.shouldReconnect = true;
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('📨 ws.onmessage:', data);
            this.handlers.forEach(h => h(data));
        };

        this.ws.onclose = () => {
            console.log('❌ WebSocket disconnected');
            this.ws = null;
            if (this.shouldReconnect) {
            }
        };

        this.ws.onerror = (error) => console.error('WebSocket error:', error);
    }

    onMessage(handler: (data: any) => void) {
        this.handlers.push(handler);
    }

    removeMessageHandler(handler: (data: any) => void) {
        const index = this.handlers.indexOf(handler);
        if (index !== -1) this.handlers.splice(index, 1);
    }

    send(toId: number, content: string) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ to_id: toId, content }));
    }

    sendTyping(toId: number, isTyping: boolean) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'typing', to_id: toId, is_typing: isTyping }));
    }

    sendReadReceipt(toId: number) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'read_receipt', to_id: toId }));
    }
}

export const wsService = new WebSocketService();
