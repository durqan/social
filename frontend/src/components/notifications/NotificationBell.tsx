import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { notificationService } from '../../services/notification.js';
import { userService } from '../../services/userService.js';
import type { SocialNotification } from '../../types.js';
import { formatRelativeDate } from '../../utils/date.js';
import { Icon } from '../ui/Icon.js';

type NotificationBellProps = {
    userId?: number;
};

const fallbackActorName = 'Пользователь';

const notificationText: Record<string, (actorName: string) => string> = {
    post_liked: actorName => `${actorName} лайкнул(а) ваш пост`,
    comment_created: actorName => `${actorName} прокомментировал(а) ваш пост`,
    friend_request: actorName => `${actorName} отправил(а) заявку в друзья`,
    friend_accepted: actorName => `${actorName} принял(а) вашу заявку`,
    message_received: actorName => `${actorName} написал(а) вам`,
};

function getNotificationTitle(notification: SocialNotification, actorName?: string) {
    const buildTitle = notificationText[notification.type];
    if (!buildTitle) {
        return 'Новое уведомление';
    }

    return buildTitle(actorName || fallbackActorName);
}

function getNotificationDetails(notification: SocialNotification) {
    switch (notification.type) {
        case 'message_received':
            return 'Открыть чат';
        case 'friend_request':
            return 'Открыть заявки в друзья';
        case 'friend_accepted':
            return 'Открыть профиль';
        case 'post_liked':
        case 'comment_created':
            return 'Открыть стену';
        default:
            return 'Открыть';
    }
}

function NotificationBadge({ count }: { count: number }) {
    if (count <= 0) {
        return null;
    }

    return (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {count > 99 ? '99+' : count}
        </span>
    );
}

export function NotificationBell({ userId }: NotificationBellProps) {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<SocialNotification[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [actorNames, setActorNames] = useState<Record<number, string>>({});
    const rootRef = useRef<HTMLDivElement>(null);

    const unreadCount = useMemo(
        () => notifications.filter(notification => !notification.is_read).length,
        [notifications],
    );

    useEffect(() => {
        if (!userId) {
            setNotifications([]);
            setActorNames({});
            return;
        }

        let cancelled = false;
        setLoading(true);
        setErrorMessage('');

        notificationService.getNotifications(userId)
            .then(data => {
                if (!cancelled) {
                    setNotifications(Array.isArray(data) ? data : []);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    console.error('Ошибка загрузки уведомлений:', error);
                    setErrorMessage('Не удалось загрузить уведомления');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        const source = notificationService.streamNotifications(userId);
        source.onmessage = event => {
            try {
                const notification = JSON.parse(event.data) as SocialNotification;
                setErrorMessage('');
                setNotifications(prev => {
                    if (prev.some(item => item.id === notification.id)) {
                        return prev;
                    }
                    return [notification, ...prev];
                });
            } catch (error) {
                console.error('Ошибка разбора уведомления:', error);
            }
        };
        source.onerror = error => {
            console.error('Ошибка SSE уведомлений:', error);
            setErrorMessage('Нет realtime-подключения');
        };

        return () => {
            cancelled = true;
            source.close();
        };
    }, [userId]);

    useEffect(() => {
        const missingActorIds = Array.from(new Set(
            notifications
                .map(notification => notification.actor_id)
                .filter(actorID => actorID > 0 && !actorNames[actorID]),
        ));

        if (missingActorIds.length === 0) {
            return;
        }

        let cancelled = false;

        missingActorIds.forEach(actorID => {
            userService.getUser(actorID)
                .then(user => {
                    if (cancelled) {
                        return;
                    }

                    setActorNames(prev => ({
                        ...prev,
                        [actorID]: user.name || fallbackActorName,
                    }));
                })
                .catch(error => {
                    console.error('Ошибка загрузки автора уведомления:', error);
                });
        });

        return () => {
            cancelled = true;
        };
    }, [actorNames, notifications]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [open]);

    const navigateToNotification = (notification: SocialNotification) => {
        if (!userId) {
            return;
        }

        switch (notification.type) {
            case 'message_received':
                navigate(`/users/${userId}/chat/${notification.actor_id}`);
                return;
            case 'friend_request':
                navigate(`/users/${userId}/friends`);
                return;
            case 'friend_accepted':
                navigate(`/users/${notification.actor_id}`);
                return;
            case 'post_liked':
            case 'comment_created':
                navigate(`/users/${userId}/wall`);
                return;
            default:
                return;
        }
    };

    const handleNotificationClick = async (notification: SocialNotification) => {
        if (notification.is_read) {
            navigateToNotification(notification);
            return;
        }

        setNotifications(prev => prev.map(item =>
            item.id === notification.id ? { ...item, is_read: true } : item
        ));

        try {
            await notificationService.markAsRead(notification.id);
        } catch (error) {
            console.error('Ошибка отметки уведомления:', error);
            setNotifications(prev => prev.map(item =>
                item.id === notification.id ? { ...item, is_read: false } : item
            ));
        }

        navigateToNotification(notification);
    };

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                className="icon-button relative h-10 w-10"
                title="Уведомления"
                aria-label="Уведомления"
                aria-expanded={open}
                onClick={() => setOpen(prev => !prev)}
            >
                <Icon name="bell" />
                <NotificationBadge count={unreadCount} />
            </button>

            {open && (
                <div className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10">
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                        <p className="font-semibold text-gray-950">Уведомления</p>
                        {unreadCount > 0 && (
                            <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                                {unreadCount}
                            </span>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {errorMessage && notifications.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-red-500">{errorMessage}</div>
                        ) : loading && notifications.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-gray-500">Загрузка...</div>
                        ) : notifications.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-gray-500">Нет уведомлений</div>
                        ) : (
                            notifications.map(notification => (
                                <button
                                    key={notification.id}
                                    type="button"
                                    onClick={() => handleNotificationClick(notification)}
                                    className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-gray-50 ${
                                        notification.is_read ? 'bg-white' : 'bg-sky-50/70'
                                    }`}
                                >
                                    <div className="flex gap-3">
                                        <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                                            notification.is_read ? 'bg-gray-300' : 'bg-sky-500'
                                        }`} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-semibold text-gray-950">
                                                {getNotificationTitle(notification, actorNames[notification.actor_id])}
                                            </span>
                                            <span className="mt-0.5 block truncate text-sm text-gray-600">
                                                {getNotificationDetails(notification)}
                                            </span>
                                            <span className="mt-1 block text-xs text-gray-400">
                                                {formatRelativeDate(notification.created_at)}
                                            </span>
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
