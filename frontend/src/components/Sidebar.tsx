import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { useWebSocket } from '../contexts/WebSocketContext.js';
import { friendService } from '../services/friendService.js';
import { messageService } from '../services/messageService.js';
import type { WsEvent } from '../types/ws/events.js';
import { Avatar } from './ui/Avatar.js';
import { Icon, type IconName } from './ui/Icon.js';

interface SidebarProps {
    userId?: number;
    userName?: string;
    userAvatar?: string | null;
    userPresence?: { online: boolean; loading?: boolean };
}

type SidebarItem = {
    key: string;
    to: string;
    label: string;
    mobileLabel: string;
    icon: IconName;
    end?: boolean;
    badge?: { count: number; color: string };
};

function CountBadge({
    count,
    color = 'bg-red-500',
    compact = false,
}: {
    count: number;
    color?: string;
    compact?: boolean;
}) {
    if (count <= 0) {
        return null;
    }

    return (
        <span className={
            compact
                ? `absolute -right-2 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px] font-bold leading-4 text-white ${color}`
                : `ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-white ${color}`
        }>
            {count > (compact ? 9 : 99) ? `${compact ? 9 : 99}+` : count}
        </span>
    );
}

const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
        isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
    }`;

const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
        isActive ? 'text-sky-700' : 'text-gray-500'
    }`;

function Sidebar({
    userId,
    userName,
    userAvatar,
    userPresence,
}: SidebarProps) {
    const wsService = useWebSocket();
    const location = useLocation();
    const [unreadCount, setUnreadCount] = useState(0);
    const [notificationCount, setNotificationCount] = useState(0);

    const refreshUnreadCount = useCallback(async () => {
        if (!userId) return;

        try {
            setUnreadCount(await messageService.getUnreadCount());
        } catch (error) {
            console.error('Ошибка загрузки непрочитанных:', error);
        }
    }, [userId]);

    const refreshFriendRequestCount = useCallback(async () => {
        if (!userId) return;

        try {
            const requests = await friendService.getFriendRequests();
            setNotificationCount(requests.length);
        } catch (error) {
            console.error('Ошибка загрузки заявок:', error);
        }
    }, [userId]);

    useEffect(() => {
        window.addEventListener('reset-unread', refreshUnreadCount);
        return () => window.removeEventListener('reset-unread', refreshUnreadCount);
    }, [refreshUnreadCount]);

    useEffect(() => {
        if (!userId) return;

        refreshUnreadCount();
        refreshFriendRequestCount();

        const handleMessage = (event: WsEvent) => {
            switch (event.type) {
                case 'friend:request':
                    refreshFriendRequestCount();
                    return;

                case 'message:new':
                    if (event.payload.to_id === userId) {
                        setUnreadCount(prev => prev + 1);
                    }
                    return;

                case 'message:read':
                    if (event.payload.from_id === userId) {
                        refreshUnreadCount();
                    }
                    return;

                default:
                    return;
            }
        };

        wsService.onMessage(handleMessage);
        return () => wsService.removeMessageHandler(handleMessage);
    }, [refreshFriendRequestCount, refreshUnreadCount, userId, wsService]);

    const navItems = useMemo<SidebarItem[]>(() => [
        {
            key: 'profile',
            to: `/users/${userId}`,
            label: 'Профиль',
            mobileLabel: 'Профиль',
            icon: 'home',
            end: true,
        },
        {
            key: 'wall',
            to: `/users/${userId}/wall`,
            label: 'Стена',
            mobileLabel: 'Стена',
            icon: 'wall',
        },
        {
            key: 'friends',
            to: `/users/${userId}/friends`,
            label: 'Друзья',
            mobileLabel: 'Друзья',
            icon: 'friends',
            badge: { count: notificationCount, color: 'bg-sky-500' },
        },
        {
            key: 'messages',
            to: `/users/${userId}/conversations`,
            label: 'Сообщения',
            mobileLabel: 'Чаты',
            icon: 'messages',
            badge: { count: unreadCount, color: 'bg-red-500' },
        },
    ], [notificationCount, unreadCount, userId]);

    const isChatPage = location.pathname.includes('/chat/');

    return (
        <>
            <aside className="fixed left-0 top-0 z-40 hidden h-full w-72 flex-col border-r border-gray-200/80 bg-white/95 px-3 py-4 shadow-sm backdrop-blur lg:flex">
                <div className="mb-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={userName} src={userAvatar} />
                        <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">{userName || 'Пользователь'}</p>
                            <p className={userPresence?.online ? 'text-xs text-emerald-600' : 'text-xs text-gray-400'}>
                                {userPresence?.online ? 'Online' : 'Offline'}
                            </p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 space-y-1">
                    {navItems.map(item => (
                        <NavLink key={item.key} to={item.to} end={item.end} className={desktopNavClass}>
                            <Icon name={item.icon} />
                            <span>{item.label}</span>
                            {item.badge && <CountBadge count={item.badge.count} color={item.badge.color} />}
                        </NavLink>
                    ))}
                </nav>
            </aside>

            {!isChatPage && (
                <nav className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-gray-200/80 bg-white/95 p-1.5 shadow-lg shadow-gray-900/10 backdrop-blur lg:hidden">
                    {navItems.map(item => (
                        <NavLink key={item.key} to={item.to} end={item.end} className={mobileNavClass}>
                            <span className="relative">
                                <Icon name={item.icon} className="h-5 w-5" />
                                {item.badge && (
                                    <CountBadge count={item.badge.count} color={item.badge.color} compact />
                                )}
                            </span>
                            <span>{item.mobileLabel}</span>
                        </NavLink>
                    ))}
                </nav>
            )}
        </>
    );
}

export default Sidebar;
