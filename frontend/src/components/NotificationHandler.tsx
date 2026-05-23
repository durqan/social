import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { toast } from 'react-hot-toast';

import { useWebSocket } from '../contexts/WebSocketContext.js';
import { useAuth } from '../contexts/AuthContext.js';

import { userService } from '../services/userService.js';

import type { WsEvent } from '../types/ws/events.js';

import { Avatar } from './ui/Avatar.js';

function NotificationHandler() {

    const navigate = useNavigate();

    const wsService = useWebSocket();

    const { currentUser } = useAuth();

    const showNotification = (
        title: string,
        message: string,
        onClick: () => void,
        borderColor: string = 'blue',
    ) => {
        const borderClass =
            borderColor === 'green'
                ? 'border-emerald-500'
                : 'border-sky-500';

        toast.custom((t) => (

            <div
                onClick={() => {
                    toast.dismiss(t.id);
                    onClick();
                }}
                className={`mx-3 max-w-sm cursor-pointer rounded-2xl border border-gray-200 border-l-4 bg-white p-4 shadow-xl shadow-gray-900/10 transition-colors hover:bg-gray-50 ${borderClass}`}
            >

                <div className="flex items-center gap-3">

                    <Avatar name={title} />

                    <div className="min-w-0 flex-1">

                        <p className="truncate font-semibold text-gray-900">
                            {title}
                        </p>

                        <p className="text-sm text-gray-600">
                            {message}
                        </p>

                    </div>

                </div>

            </div>

        ), {
            duration: 5000,
            position: 'top-right',
        });
    };

    useEffect(() => {

        const shownNotifications = new Set<number>();

        const handleMessage = async (event: WsEvent) => {

            switch (event.type) {

                // =========================
                // IGNORE
                // =========================
                case 'typing:start':
                case 'typing:stop':
                case 'message:delete':
                case 'message:read':
                case 'call:offer':
                case 'call:answer':
                case 'call:ice':
                case 'call:end':
                case 'call:reject':
                case 'presence:update':
                    return;

                // =========================
                // FRIEND REQUEST
                // =========================
                case 'friend:request': {

                    const payload = event.payload;

                    showNotification(
                        payload.from_name || 'Пользователь',
                        'Отправил(а) заявку в друзья',
                        () => navigate(`/users/${payload.from_id}`),
                        'blue',
                    );

                    return;
                }

                // =========================
                // FRIEND ACCEPTED
                // =========================
                case 'friend:accepted': {

                    const payload = event.payload;

                    showNotification(
                        payload.from_name || 'Пользователь',
                        'Принял(а) заявку в друзья',
                        () => navigate(`/users/${payload.from_id}`),
                        'green',
                    );

                    return;
                }

                // =========================
                // MESSAGE
                // =========================
                case 'message:new': {

                    const msg = event.payload;

                    if (shownNotifications.has(msg.id)) {
                        return;
                    }

                    const currentUserId = currentUser?.id;

                    if (!currentUserId) {
                        return;
                    }

                    if (msg.from_id === currentUserId) {
                        return;
                    }

                    const pathname = window.location.pathname;

                    const isChatOpen =
                        pathname.includes(`/chat/${msg.from_id}`);

                    if (isChatOpen) {
                        return;
                    }

                    shownNotifications.add(msg.id);

                    let senderName = 'Пользователь';

                    try {

                        const user = await userService.getUser(
                            msg.from_id
                        );

                        senderName =
                            user.name || 'Пользователь';

                    } catch (e) {
                        console.error(e);
                    }

                    toast.custom((t) => (

                        <div
                            onClick={() => {
                                toast.dismiss(t.id);

                                navigate(
                                    `/users/${currentUserId}/chat/${msg.from_id}`
                                );
                            }}
                            className="mx-3 max-w-sm cursor-pointer rounded-2xl border border-gray-200 bg-white p-4 shadow-xl shadow-gray-900/10 transition-colors hover:bg-gray-50"
                        >

                            <div className="flex items-center gap-3">

                                <Avatar name={senderName} />

                                <div className="min-w-0 flex-1">

                                    <p className="truncate font-semibold text-gray-900">
                                        {senderName}
                                    </p>

                                    <p className="text-sm text-gray-600 truncate">
                                        {msg.content.slice(0, 50)}
                                    </p>

                                </div>

                            </div>

                        </div>

                    ), {
                        duration: 5000,
                        position: 'top-right',
                    });

                    setTimeout(() => {
                        shownNotifications.delete(msg.id);
                    }, 10000);

                    return;
                }

                default:
                    return;
            }
        };

        wsService.onMessage(handleMessage);

        return () => {
            wsService.removeMessageHandler(
                handleMessage
            );
        };

    }, [
        currentUser?.id,
        navigate,
        wsService,
    ]);

    return null;
}

export default NotificationHandler;
