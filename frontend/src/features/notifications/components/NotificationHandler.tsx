import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { toast } from 'react-hot-toast';

import { useAuth } from "@/app/providers/AuthContext.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { userService } from "@/shared/api/userService.js";
import type { WsEvent } from "@/shared/types/ws.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { WS_EVENTS } from '@social/shared';

const ignoredEvents: ReadonlySet<WsEvent['type']> = new Set([
    WS_EVENTS.TYPING_START,
    WS_EVENTS.TYPING_STOP,
    WS_EVENTS.MESSAGE_DELETE,
    WS_EVENTS.MESSAGE_UPDATE,
    WS_EVENTS.MESSAGE_ERROR,
    WS_EVENTS.MESSAGE_READ,
    WS_EVENTS.CONVERSATION_READ,
    WS_EVENTS.CALL_OFFER,
    WS_EVENTS.CALL_ANSWER,
    WS_EVENTS.CALL_ICE,
    WS_EVENTS.CALL_END,
    WS_EVENTS.CALL_REJECT,
    WS_EVENTS.PRESENCE_UPDATE,
]);

type NotificationToast = {
    title: string;
    message: string;
    onClick: () => void;
    actorId?: number;
    onActorClick?: () => void;
    tone?: 'default' | 'blue' | 'green';
};

function showNotificationToast({
    title,
    message,
    onClick,
    actorId,
    onActorClick,
    tone = 'default',
}: NotificationToast) {
    const borderClass = {
        default: '',
        blue: 'border-l-4 border-sky-500',
        green: 'border-l-4 border-emerald-500',
    }[tone];

    toast.custom((toastRef) => (
        <div
            onClick={() => {
                toast.dismiss(toastRef.id);
                onClick();
            }}
            className={`mx-3 max-w-sm cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 shadow-xl shadow-gray-900/10 transition-colors hover:bg-gray-50 ${borderClass}`}
        >
            <div className="flex items-center gap-3">
                <Avatar
                    name={title}
                    ariaLabel={`Открыть профиль ${title || 'пользователя'}`}
                    onClick={actorId && onActorClick ? onActorClick : undefined}
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-gray-900">{title}</p>
                    <p className="truncate text-sm text-gray-600">{message}</p>
                </div>
            </div>
        </div>
    ), {
        duration: 5000,
        position: 'top-right',
    });
}

function NotificationHandler() {
    const navigate = useNavigate();
    const wsService = useWebSocket();
    const { currentUser } = useAuth();

    useEffect(() => {
        if (!currentUser?.id) {
            wsService.disconnect();
            return;
        }

        wsService.connect();

        const shownMessageNotifications = new Set<number>();

        const handleMessage = async (event: WsEvent) => {
            if (ignoredEvents.has(event.type)) {
                return;
            }

            switch (event.type) {
                case WS_EVENTS.FRIEND_REQUEST:
                    showNotificationToast({
                        title: event.payload.from_name || 'Пользователь',
                        message: 'Отправил(а) заявку в друзья',
                        tone: 'blue',
                        actorId: event.payload.from_id,
                        onClick: () => navigate(`/users/${event.payload.from_id}`),
                        onActorClick: () => navigate(`/users/${event.payload.from_id}`),
                    });
                    return;

                case WS_EVENTS.FRIEND_ACCEPTED:
                    showNotificationToast({
                        title: event.payload.from_name || 'Пользователь',
                        message: 'Принял(а) заявку в друзья',
                        tone: 'green',
                        actorId: event.payload.from_id,
                        onClick: () => navigate(`/users/${event.payload.from_id}`),
                        onActorClick: () => navigate(`/users/${event.payload.from_id}`),
                    });
                    return;

                case WS_EVENTS.MESSAGE_NEW: {
                    const message = event.payload;
                    const currentUserId = currentUser?.id;

                    if (
                        !currentUserId ||
                        message.from_id === currentUserId ||
                        shownMessageNotifications.has(message.id) ||
                        window.location.pathname.includes(`/chat/${message.from_id}`)
                    ) {
                        return;
                    }

                    shownMessageNotifications.add(message.id);

                    let senderName = 'Пользователь';
                    try {
                        const sender = await userService.getUser(message.from_id);
                        senderName = sender.name || 'Пользователь';
                    } catch (error) {
                        console.error(error);
                    }

                    showNotificationToast({
                        title: senderName,
                        message: message.content.slice(0, 50),
                        actorId: message.from_id,
                        onActorClick: () => navigate(`/users/${message.from_id}`),
                        onClick: () => navigate(`/users/${currentUserId}/chat/${message.from_id}`),
                    });

                    window.setTimeout(() => {
                        shownMessageNotifications.delete(message.id);
                    }, 10000);
                    return;
                }

                default:
                    return;
            }
        };

        wsService.onMessage(handleMessage);
        return () => wsService.removeMessageHandler(handleMessage);
    }, [currentUser?.id, navigate, wsService]);

    return null;
}

export default NotificationHandler;
