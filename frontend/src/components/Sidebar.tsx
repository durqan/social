import {useState, useEffect} from 'react';
import {NavLink, useLocation} from 'react-router-dom';
import {useWebSocket} from '../contexts/WebSocketContext.js';
import {messageService} from '../services/messageService.js';
import {friendService} from '../services/friendService.js';
import {Avatar} from './ui/Avatar.js';
import {Icon} from './ui/Icon.js';
import type {WsEvent} from '../types/ws/events.js';

interface SidebarProps {
    userId?: number | undefined,
    userName?: string | undefined,
    userAvatar?: string | null | undefined,
    userPresence?: { online: boolean; loading?: boolean }
}

function Sidebar({
                     userId,
                     userName,
                     userAvatar,
                     userPresence
                 }: SidebarProps) {

    const wsService = useWebSocket();
    const location = useLocation();
    const [unreadCount, setUnreadCount] = useState(0);
    const [notificationCount, setNotificationCount] = useState(0);

    const refreshUnreadCount = async () => {
        if (!userId) return;

        try {
            setUnreadCount(await messageService.getUnreadCount());

        } catch (error) {
            console.error(
                'Ошибка загрузки непрочитанных:',
                error
            );
        }
    };

    const refreshFriendRequestCount = async () => {
        if (!userId) return;

        try {
            const requests = await friendService.getFriendRequests();
            setNotificationCount(requests.length);
        } catch (error) {
            console.error(
                'Ошибка загрузки заявок:',
                error
            );
        }
    };

    useEffect(() => {

        const handleResetUnread = () => {
            setUnreadCount(0);
        };

        window.addEventListener(
            'reset-unread',
            handleResetUnread
        );

        return () => {
            window.removeEventListener(
                'reset-unread',
                handleResetUnread
            );
        };

    }, []);

    // =========================
    // FRIEND NOTIFICATIONS
    // =========================

    useEffect(() => {

        if (!userId) return;

        refreshFriendRequestCount();

        const handleNotification = (event: WsEvent) => {
            switch (event.type) {

                case 'friend:request':
                    refreshFriendRequestCount();
                    break;
                case 'friend:accepted':
                    break;
            }
        };

        wsService.onMessage(handleNotification);

        return () => {
            wsService.removeMessageHandler(
                handleNotification
            );
        };

    }, [userId, wsService]);

    // =========================
    // UNREAD MESSAGES
    // =========================

    useEffect(() => {

        if (!userId) return;

        refreshUnreadCount();

        const handleNewMessage = (event: WsEvent) => {
            switch (event.type) {
                case 'message:new': {
                    const msg = event.payload;
                    if (msg.to_id === Number(userId)) {
                        setUnreadCount(prev => prev + 1);
                    }
                    break;
                }
                case 'message:read': {
                    const payload = event.payload;

                    if (payload.from_id === Number(userId)) {
                        refreshUnreadCount();
                    }
                    break;
                }
            }
        };

        wsService.onMessage(handleNewMessage);

        return () => {
            wsService.removeMessageHandler(
                handleNewMessage
            );
        };

    }, [userId, wsService]);

    const isChatPage = location.pathname.includes('/chat/');

    const badge = (count: number, color = 'bg-red-500') => (
        count > 0 ? (
            <span className={`ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white ${color}`}>
                {count > 99 ? '99+' : count}
            </span>
        ) : null
    );

    const navClass = ({isActive}: { isActive: boolean }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
                ? 'bg-sky-50 text-sky-700'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
        }`;

    const mobileNavClass = ({isActive}: { isActive: boolean }) =>
        `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
            isActive
                ? 'text-sky-700'
                : 'text-gray-500'
        }`;

    return (
        <>
            <aside
                className="fixed left-0 top-0 z-40 hidden h-full w-72 flex-col border-r border-gray-200/80 bg-white/95 px-3 py-4 shadow-sm backdrop-blur lg:flex"
            >
                <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                            name={userName}
                            src={userAvatar}
                        />

                        <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">
                                {userName || 'Пользователь'}
                            </p>
                            <p className={userPresence?.online ? 'text-xs text-emerald-600' : 'text-xs text-gray-400'}>
                                {userPresence?.online ? 'Online' : 'Offline'}
                            </p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 space-y-1">
                    <NavLink
                        to={`/users/${userId}`}
                        end
                        className={navClass}
                    >
                        <Icon name="home"/>
                        <span>Профиль</span>
                    </NavLink>

                    <NavLink
                        to={`/users/${userId}/wall`}
                        className={navClass}
                    >
                        <Icon name="wall"/>
                        <span>Стена</span>
                    </NavLink>

                    <NavLink
                        to={`/users/${userId}/friends`}
                        className={navClass}
                    >
                        <Icon name="friends"/>
                        <span>Друзья</span>
                        {badge(notificationCount, 'bg-sky-500')}
                    </NavLink>

                    <NavLink
                        to={`/users/${userId}/conversations`}
                        className={navClass}
                    >
                        <Icon name="messages"/>
                        <span>Сообщения</span>
                        {badge(unreadCount)}
                    </NavLink>
                </nav>
            </aside>

            {!isChatPage && (
                <nav className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-gray-200/80 bg-white/95 p-1.5 shadow-lg shadow-gray-900/10 backdrop-blur lg:hidden">
                    <NavLink to={`/users/${userId}`} end className={mobileNavClass}>
                        <Icon name="home" className="h-5 w-5" />
                        <span>Профиль</span>
                    </NavLink>

                    <NavLink to={`/users/${userId}/wall`} className={mobileNavClass}>
                        <Icon name="wall" className="h-5 w-5" />
                        <span>Стена</span>
                    </NavLink>

                    <NavLink to={`/users/${userId}/friends`} className={mobileNavClass}>
                        <span className="relative">
                            <Icon name="friends" className="h-5 w-5" />
                            {notificationCount > 0 && (
                                <span className="absolute -right-2 -top-1 h-4 min-w-4 rounded-full bg-sky-500 px-1 text-[10px] font-bold leading-4 text-white">
                                    {notificationCount > 9 ? '9+' : notificationCount}
                                </span>
                            )}
                        </span>
                        <span>Друзья</span>
                    </NavLink>

                    <NavLink to={`/users/${userId}/conversations`} className={mobileNavClass}>
                        <span className="relative">
                            <Icon name="messages" className="h-5 w-5" />
                            {unreadCount > 0 && (
                                <span className="absolute -right-2 -top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                            )}
                        </span>
                        <span>Чаты</span>
                    </NavLink>
                </nav>
            )}
        </>
    );
}

export default Sidebar;
