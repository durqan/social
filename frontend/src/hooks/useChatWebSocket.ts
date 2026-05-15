import {useEffect, useRef} from 'react';
import {useWebSocket} from '../contexts/WebSocketContext.js';
import type {Message} from '../types.js';
import type {WsEvent} from '../types/ws.js';

interface UseChatWebSocketProps {
    userId: string | undefined;
    currentUserId: number | undefined;
    onTyping: (isTyping: boolean) => void;
    onMessageDeleted: (messageId: number) => void;
    onReadReceipt: (fromId: number) => void;
    onNewMessage: (msg: Message) => void;
}

export const useChatWebSocket = ({
                                     userId,
                                     currentUserId,
                                     onTyping,
                                     onMessageDeleted,
                                     onReadReceipt,
                                     onNewMessage,
                                 }: UseChatWebSocketProps) => {
    const isSubscribed = useRef(false);
    const wsService = useWebSocket();

    useEffect(() => {
        if (isSubscribed.current) return;
        isSubscribed.current = true;

        const handleMessage = (event: WsEvent) => {

            switch (event.type) {
                case 'typing': {
                    const payload = event.payload;
                    if (payload.from_id === Number(userId)) {
                        onTyping(payload.is_typing);
                    }
                    break;
                }
                case 'message_deleted': {
                    const payload = event.payload;
                    onMessageDeleted(payload.message_id);
                    break;
                }
                case 'read_receipt': {
                    const payload = event.payload;
                    if (payload.to_id === currentUserId) {
                        onReadReceipt(payload.to_id);
                    }
                    break;
                }
                case 'message': {
                    const payload = event.payload;
                    if (
                        payload.from_id === Number(userId) ||
                        payload.to_id === Number(userId)
                    ) {
                        onNewMessage(payload);
                    }
                    break;
                }
                default:
                    console.warn('Unknown WS event:', event);
            }
        };

        wsService.onMessage(handleMessage);
        wsService.connect();

        return () => {
            wsService.removeMessageHandler(handleMessage);
        };
    }, [userId, currentUserId, onTyping, onMessageDeleted, onReadReceipt, onNewMessage, wsService]);
};
