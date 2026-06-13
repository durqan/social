import { useEffect } from 'react';

import { useWebSocket } from "@/app/providers/WebSocketContext.js";

import type { Message, PinnedMessage } from "@/shared/types/domain.js";
import type { WsEvent } from "@/shared/types/ws.js";
import { WS_EVENTS } from '@social/shared';

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

    onConversationRead: (conversationId: number) => void;

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
    onConversationRead,
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
                case WS_EVENTS.TYPING_START: {

                    const payload = event.payload;

                    if (payload.from_id === Number(userId)) {
                        onTyping(true);
                    }

                    break;
                }

                // =========================
                // TYPING STOP
                // =========================
                case WS_EVENTS.TYPING_STOP: {

                    const payload = event.payload;

                    if (payload.from_id === Number(userId)) {
                        onTyping(false);
                    }

                    break;
                }

                // =========================
                // MESSAGE DELETE
                // =========================
                case WS_EVENTS.MESSAGE_DELETE: {

                    const payload = event.payload;

                    onMessageDeleted(payload.message_id);

                    break;
                }

                // =========================
                // READ RECEIPT
                // =========================
                case WS_EVENTS.MESSAGE_READ: {

                    const payload = event.payload;

                    if (
                        payload.to_id === currentUserId &&
                        payload.from_id === Number(userId)
                    ) {
                        onReadReceipt(currentUserId);
                    }

                    break;
                }

                case WS_EVENTS.CONVERSATION_READ: {
                    const payload = event.payload;
                    if (
                        payload.reader_id === currentUserId &&
                        payload.conversation_id === Number(userId)
                    ) {
                        onConversationRead(payload.conversation_id);
                    }

                    break;
                }

                // =========================
                // NEW MESSAGE
                // =========================
                case WS_EVENTS.MESSAGE_NEW: {

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
                case WS_EVENTS.MESSAGE_UPDATE: {

                    const payload = event.payload;

                    if (
                        payload.from_id === Number(userId) ||
                        payload.to_id === Number(userId)
                    ) {
                        onMessageUpdated(payload);
                    }

                    break;
                }

                case WS_EVENTS.MESSAGE_PINNED: {

                    const payload = event.payload.pinned_message;

                    if (belongsToCurrentChat(payload.message, userId, currentUserId)) {
                        onMessagePinned(payload);
                    }

                    break;
                }

                case WS_EVENTS.MESSAGE_UNPINNED: {

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

                case WS_EVENTS.CALL_OFFER:
                case WS_EVENTS.CALL_ANSWER:
                case WS_EVENTS.CALL_ICE:
                case WS_EVENTS.CALL_END:
                case WS_EVENTS.CALL_REJECT:
                case WS_EVENTS.PRESENCE_UPDATE:
                case WS_EVENTS.FRIEND_REQUEST:
                case WS_EVENTS.FRIEND_ACCEPTED:
                case WS_EVENTS.MESSAGE_ERROR:
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
        onConversationRead,
        onNewMessage,
        onMessageUpdated,
        onMessagePinned,
        onMessageUnpinned,
        wsService,
    ]);
};
