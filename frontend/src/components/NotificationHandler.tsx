import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { wsService } from '../services/ws.js';
import api from '../api/axios.js';

function NotificationHandler() {
    const navigate = useNavigate();
    const isSubscribed = useRef(false);

    const showNotification = (title: string, message: string, onClick: () => void, borderColor: string = 'blue') => {
        toast.custom((t) => (
            <div
                onClick={() => {
                    toast.dismiss(t.id);
                    onClick();
                }}
                className={`bg-white rounded-lg shadow-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors max-w-sm border-l-4 border-${borderColor}-500`}
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                        {title.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                        <p className="font-semibold text-gray-800">{title}</p>
                        <p className="text-sm text-gray-600">{message}</p>
                    </div>
                </div>
            </div>
        ), { duration: 5000, position: 'top-right' });
    };

    useEffect(() => {
        if (isSubscribed.current) return;
        isSubscribed.current = true;

        const shownNotifications = new Set<number>();

        const handleMessage = async (msg: any) => {
            if (msg.type === 'typing' || msg.type === 'message_deleted') return;
            if (shownNotifications.has(msg.id)) return;

            if (msg.type === 'friend_request') {
                showNotification(
                    msg.from_name || 'Пользователь',
                    'Отправил(а) заявку в друзья',
                    () => navigate(`/users/${msg.from_id}`),
                    'blue'
                );
                return;
            }

            if (msg.type === 'friend_accepted') {
                showNotification(
                    msg.from_name || 'Пользователь',
                    'Принял(а) заявку в друзья',
                    () => navigate(`/users/${msg.from_id}`),
                    'green'
                );
                return;
            }

            let currentUserId: number | null = null;
            try {
                const res = await api.get('/users/profile');
                currentUserId = res.data.id;
            } catch (e) {
                return;
            }

            if (msg.from_id !== currentUserId) {
                const pathname = window.location.pathname;
                const isChatOpen = pathname.includes(`/chat/${msg.from_id}`);

                if (!isChatOpen) {
                    shownNotifications.add(msg.id);

                    let senderName = 'Пользователь';
                    try {
                        const userRes = await api.get(`/users/${msg.from_id}`);
                        senderName = userRes.data.name || 'Пользователь';
                    } catch (e) {}

                    toast.custom((t) => (
                        <div
                            onClick={() => {
                                toast.dismiss(t.id);
                                navigate(`/users/${currentUserId}/chat/${msg.from_id}`);
                            }}
                            className="bg-white rounded-lg shadow-lg p-4 cursor-pointer hover:bg-gray-50 transition-colors max-w-sm border border-gray-200"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                                    {senderName.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-800">{senderName}</p>
                                    <p className="text-sm text-gray-600 truncate">{msg.content.slice(0, 50)}</p>
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
                }
            }
        };

        wsService.onMessage(handleMessage);
    }, [navigate]);

    return null;
}

export default NotificationHandler;