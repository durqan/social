import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import api from '../api/axios.js';
import { wsService } from '../services/ws.js';

interface SidebarProps {
    userId?: number | undefined;
    userName?: string | undefined;
    userAvatar?: string | null | undefined;
}

function Sidebar({ userId, userName, userAvatar }: SidebarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const refreshUnreadCount = async () => {
        if (!userId) return;
        try {
            const res = await api.get('/messages/unread/count');
            setUnreadCount(res.data.unread_count);
        } catch (error) {
            console.error('Ошибка загрузки непрочитанных:', error);
        }
    };

    useEffect(() => {
        const handleResetUnread = () => {
            setUnreadCount(0);
        };
        window.addEventListener('reset-unread', handleResetUnread);
        return () => window.removeEventListener('reset-unread', handleResetUnread);
    }, []);

    useEffect(() => {
        if (!userId) return;

        refreshUnreadCount();

        const handleNewMessage = (msg: any) => {
            const pathname = window.location.pathname;
            const isChatOpen = pathname.includes(`/chat/${msg.from_id}`);

            if (msg.to_id === userId && !msg.is_read) {
                if (isChatOpen) {
                    // Чат открыт, сразу отмечаем прочитанным
                    refreshUnreadCount();
                } else {
                    setUnreadCount(prev => prev + 1);
                }
            }
        };

        const handleReadReceipt = () => {
            refreshUnreadCount();
        };

        wsService.onMessage(handleNewMessage);
        wsService.onMessage(handleReadReceipt);

        return () => {
            wsService.removeMessageHandler(handleNewMessage);
            wsService.removeMessageHandler(handleReadReceipt);
        };
    }, [userId]);

    const getInitials = (name?: string) => {
        if (!name) return '😎';
        return name.charAt(0).toUpperCase();
    };

    const closeSidebar = () => setIsOpen(false);

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md lg:hidden"
            >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
            </button>
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                    onClick={closeSidebar}
                />
            )}
            <aside className={`
                fixed top-0 left-0 h-full bg-white border-r border-gray-200 flex flex-col shadow-xl z-50 transition-transform duration-300
                w-64
                ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                lg:translate-x-0
            `}>
                <button
                    onClick={closeSidebar}
                    className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 lg:hidden"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center gap-3">
                        {userAvatar ? (
                            <img
                                src={userAvatar}
                                alt="Avatar"
                                className="w-10 h-10 rounded-full object-cover"
                            />
                        ) : (
                            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                                {getInitials(userName)}
                            </div>
                        )}
                        <div>
                            <p className="font-semibold text-gray-800">{userName || 'Пользователь'}</p>
                            <p className="text-xs text-gray-500">Online</p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 py-4" onClick={closeSidebar}>
                    <NavLink
                        to={`/users/${userId}`}
                        end
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }`
                        }
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                        </svg>
                        <span>Моя страница</span>
                    </NavLink>

                    <NavLink
                        to={`/users/${userId}/wall`}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }`
                        }
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                        </svg>
                        <span>Моя стена</span>
                    </NavLink>

                    <NavLink
                        to={`/users/${userId}/conversations`}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }`
                        }
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span>Сообщения</span>
                        {unreadCount > 0 && (
                            <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </NavLink>
                    <NavLink
                        to={`/users/${userId}/friends`}
                        className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                                isActive
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-gray-700 hover:bg-gray-100'
                            }`
                        }
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <span>Друзья</span>
                    </NavLink>
                </nav>
            </aside>

            <div className="hidden lg:block w-64" />
        </>
    );
}

export default Sidebar;