import { useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext.js';
import type { Message } from '../types.js';
import { isMessageEvent, isTypedEvent, type WsEvent } from '../types/ws.js';

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

        const handleMessage = (msg: WsEvent) => {
            if (isTypedEvent(msg, 'typing') && msg.from_id === Number(userId)) {
                onTyping(msg.is_typing);
                return;
            }
            if (isTypedEvent(msg, 'message_deleted')) {
                onMessageDeleted(msg.message_id);
                return;
            }
            if (isTypedEvent(msg, 'read_receipt') && msg.to_id === currentUserId) {
                onReadReceipt(msg.to_id);
                return;
            }
            if (isMessageEvent(msg) && (msg.from_id === Number(userId) || msg.to_id === Number(userId))) {
                onNewMessage(msg);
            }
        };

        wsService.onMessage(handleMessage);
        wsService.connect();

        return () => {
            wsService.removeMessageHandler(handleMessage);
        };
    }, [userId, currentUserId, onTyping, onMessageDeleted, onReadReceipt, onNewMessage, wsService]);
};
