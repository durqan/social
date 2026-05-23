import {useState, useEffect} from 'react';
import {NavLink} from 'react-router-dom';
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
    userPresence?: { online: boolean; loading: boolean }
}

function Sidebar({
                     userId,
                     userName,
                     userAvatar,
                     userPresence
                 }: SidebarProps) {

    const wsService = useWebSocket();
    const [isOpen, setIsOpen] = useState(false);
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

    const closeSidebar = () => {
        setIsOpen(false);
    };

    return (
        <>
            {/* MOBILE BURGER */}
            <button
                onClick={() => setIsOpen(true)}
                className="
                    fixed top-4 left-4 z-50
                    p-2 bg-white rounded-lg shadow-md
                    lg:hidden
                "
            >
                <Icon
                    name="menu"
                    className="w-6 h-6 text-gray-600"
                />
            </button>

            {/* OVERLAY */}
            {isOpen && (
                <div
                    className="
                        fixed inset-0
                        bg-black bg-opacity-50
                        z-40 lg:hidden
                    "
                    onClick={closeSidebar}
                />
            )}

            {/* SIDEBAR */}
            <aside
                className={`
                    fixed top-0 left-0 h-full
                    bg-white border-r border-gray-200
                    flex flex-col shadow-xl
                    z-50 transition-transform duration-300
                    w-64
                    ${isOpen
                    ? 'translate-x-0'
                    : '-translate-x-full'}
                    lg:translate-x-0
                `}
            >

                {/* CLOSE BUTTON */}
                <button
                    onClick={closeSidebar}
                    className="
                        absolute top-4 right-4
                        p-1 text-gray-400
                        hover:text-gray-600
                        lg:hidden
                    "
                >
                    <Icon
                        name="close"
                        className="w-6 h-6"
                    />
                </button>

                {/* PROFILE */}
                <div className="p-4 border-b border-gray-200">

                    <div className="flex items-center gap-3">

                        <Avatar
                            name={userName}
                            src={userAvatar}
                        />

                        <div>
                            <p className="font-semibold text-gray-800">
                                {userName || 'Пользователь'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* NAVIGATION */}
                <nav
                    className="flex-1 py-4"
                    onClick={closeSidebar}
                >

                    {/* PROFILE */}
                    <NavLink
                        to={`/users/${userId}`}
                        end
                        className={({isActive}) =>
                            `
                                flex items-center gap-3
                                px-4 py-3 mx-2 rounded-lg
                                transition-colors
                                ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }
                            `
                        }
                    >
                        <Icon name="home"/>
                        <span>Моя страница</span>
                    </NavLink>

                    {/* WALL */}
                    <NavLink
                        to={`/users/${userId}/wall`}
                        className={({isActive}) =>
                            `
                                flex items-center gap-3
                                px-4 py-3 mx-2 rounded-lg
                                transition-colors
                                ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }
                            `
                        }
                    >
                        <Icon name="wall"/>
                        <span>Моя стена</span>
                    </NavLink>

                    {/* FRIENDS */}
                    <NavLink
                        to={`/users/${userId}/friends`}
                        className={({isActive}) =>
                            `
                                flex items-center gap-3
                                px-4 py-3 mx-2 rounded-lg
                                transition-colors
                                ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }
                            `
                        }
                    >
                        <Icon name="friends"/>

                        <span>Друзья</span>

                        {notificationCount > 0 && (
                            <span
                                className="
                                    ml-auto
                                    bg-blue-500 text-white
                                    text-xs rounded-full
                                    px-2 py-0.5
                                "
                            >
                                {notificationCount}
                            </span>
                        )}
                    </NavLink>

                    {/* MESSAGES */}
                    <NavLink
                        to={`/users/${userId}/conversations`}
                        className={({isActive}) =>
                            `
                                flex items-center gap-3
                                px-4 py-3 mx-2 rounded-lg
                                transition-colors
                                ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }
                            `
                        }
                    >
                        <Icon name="messages"/>

                        <span>Сообщения</span>

                        {unreadCount > 0 && (
                            <span
                                className="
                                    ml-auto
                                    bg-red-500 text-white
                                    text-xs rounded-full
                                    px-2 py-0.5
                                "
                            >
                                {unreadCount > 99
                                    ? '99+'
                                    : unreadCount}
                            </span>
                        )}
                    </NavLink>

                </nav>

            </aside>

            {/* DESKTOP SPACER */}
            <div className="hidden lg:block w-64"/>
        </>
    );
}

export default Sidebar;
