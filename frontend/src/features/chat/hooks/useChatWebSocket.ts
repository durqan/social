import { useEffect } from 'react';

import { useWebSocket } from "@/app/providers/WebSocketContext.js";

import type { Message, PinnedMessage } from "@/shared/types/domain.js";
import type { WsEvent } from "@/shared/types/ws.js";

const belongsToCurrentChat = (
    message: Message,
    userId: string | undefined,
    currentUserId: number | undefined,
) => {
    const otherUserId = Number(userId);

    return Boolean(
        currentUserId &&
        otherUserId &&
        (
            (message.from_id === otherUserId && message.to_id === currentUserId) ||
            (message.to_id === otherUserId && message.from_id === currentUserId)
        )
    );
};

interface UseChatWebSocketProps {
    userId: string | undefined;
    currentUserId: number | undefined;

    onTyping: (isTyping: boolean) => void;

    onMessageDeleted: (messageId: number) => void;

    onReadReceipt: (fromId: number) => void;

    onNewMessage: (msg: Message) => void;

    onMessageUpdated: (msg: Message) => void;

    onMessagePinned: (pinnedMessage: PinnedMessage) => void;

    onMessageUnpinned: () => void;
}

export const useChatWebSocket = ({
    userId,
    currentUserId,
    onTyping,
    onMessageDeleted,
    onReadReceipt,
    onNewMessage,
    onMessageUpdated,
    onMessagePinned,
    onMessageUnpinned,
}: UseChatWebSocketProps) => {
    const wsService = useWebSocket();

    useEffect(() => {
        const handleMessage = (event: WsEvent) => {

            switch (event.type) {

                // =========================
                // TYPING START
                // =========================
                case 'typing:start': {

                    const payload = event.payload;

                    if (payload.from_id === Number(userId)) {
                        onTyping(true);
                    }

                    break;
                }

                // =========================
                // TYPING STOP
                // =========================
                case 'typing:stop': {

                    const payload = event.payload;

                    if (payload.from_id === Number(userId)) {
                        onTyping(false);
                    }

                    break;
                }

                // =========================
                // MESSAGE DELETE
                // =========================
                case 'message:delete': {

                    const payload = event.payload;

                    onMessageDeleted(payload.message_id);

                    break;
                }

                // =========================
                // READ RECEIPT
                // =========================
                case 'message:read': {

                    const payload = event.payload;

                    if (
                        payload.to_id === currentUserId &&
                        payload.from_id === Number(userId)
                    ) {
                        onReadReceipt(currentUserId);
                    }

                    break;
                }

                // =========================
                // NEW MESSAGE
                // =========================
                case 'message:new': {

                    const payload = event.payload;

                    if (
                        payload.from_id === Number(userId) ||
                        payload.to_id === Number(userId)
                    ) {
                        onNewMessage(payload);
                    }

                    break;
                }

                // =========================
                // MESSAGE UPDATE
                // =========================
                case 'message:update': {

                    const payload = event.payload;

                    if (
                        payload.from_id === Number(userId) ||
                        payload.to_id === Number(userId)
                    ) {
                        onMessageUpdated(payload);
                    }

                    break;
                }

                case 'message_pinned': {

                    const payload = event.payload.pinned_message;

                    if (belongsToCurrentChat(payload.message, userId, currentUserId)) {
                        onMessagePinned(payload);
                    }

                    break;
                }

                case 'message_unpinned': {

                    const payload = event.payload;
                    const otherUserId = Number(userId);

                    if (
                        currentUserId &&
                        otherUserId &&
                        payload.participant_ids.includes(currentUserId) &&
                        payload.participant_ids.includes(otherUserId)
                    ) {
                        onMessageUnpinned();
                    }

                    break;
                }

                case 'call:offer':
                case 'call:answer':
                case 'call:ice':
                case 'call:end':
                case 'call:reject':
                case 'presence:update':
                case 'friend:request':
                case 'friend:accepted':
                case 'message:error':
                    break;

                default:
                    break;
            }
        };

        wsService.onMessage(handleMessage);

        wsService.connect();

        return () => {
            wsService.removeMessageHandler(
                handleMessage
            );
        };

    }, [
        userId,
        currentUserId,
        onTyping,
        onMessageDeleted,
        onReadReceipt,
        onNewMessage,
        onMessageUpdated,
        onMessagePinned,
        onMessageUnpinned,
        wsService,
    ]);
};
