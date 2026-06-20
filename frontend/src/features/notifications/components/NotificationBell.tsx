import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    notificationService,
    type MarkNotificationsReadPayload,
} from "@/features/notifications/api/notificationService.js";
import { userService } from "@/shared/api/userService.js";
import type { SocialNotification } from "@/shared/types/domain.js";
import { formatRelativeDate } from "@/shared/utils/date.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

type NotificationBellProps = {
    userId?: number;
    compact?: boolean;
};

const fallbackActorName = 'Пользователь';

const notificationText: Record<string, (actorName: string) => string> = {
    post_liked: actorName => `${actorName} лайкнул(а) ваш пост`,
    comment_created: actorName => `${actorName} прокомментировал(а) ваш пост`,
    friend_request: actorName => `${actorName} отправил(а) заявку в друзья`,
    friend_accepted: actorName => `${actorName} принял(а) вашу заявку`,
    message_received: actorName => `${actorName} написал(а) вам`,
    incoming_call: actorName => `${actorName} звонил(а) вам`,
};

let notificationAudioContext: AudioContext | null = null;

function getNotificationAudioContext() {
    if (notificationAudioContext) {
        return notificationAudioContext;
    }

    notificationAudioContext = new AudioContext();
    return notificationAudioContext;
}

function unlockNotificationSound() {
    const audioContext = getNotificationAudioContext();
    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(error => {
            console.error('Ошибка включения звука уведомлений:', error);
        });
    }
}

function playNotificationSound() {
    try {
        const audioContext = getNotificationAudioContext();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.setValueAtTime(660, now + 0.11);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.3);
    } catch (error) {
        console.error('Ошибка проигрывания звука уведомления:', error);
    }
}

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
        case 'incoming_call':
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

function getNotificationURL(notification: SocialNotification, userId: number) {
    switch (notification.type) {
        case 'message_received':
            return `/users/${userId}/chat/${notification.actor_id}`;
        case 'incoming_call':
            return `/users/${userId}/chat/${notification.conversation_id || notification.actor_id}`;
        case 'friend_request':
            return `/users/${userId}/friends`;
        case 'friend_accepted':
            return `/users/${notification.actor_id}`;
        case 'post_liked':
        case 'comment_created':
            return `/users/${userId}/wall`;
        default:
            return `/users/${userId}`;
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

function matchesReadPayload(notification: SocialNotification, payload: MarkNotificationsReadPayload) {
    if (payload.types.length > 0 && !payload.types.includes(notification.type)) {
        return false;
    }
    if (payload.actor_id !== undefined && notification.actor_id !== payload.actor_id) {
        return false;
    }
    if (payload.entity_id !== undefined && notification.entity_id !== payload.entity_id) {
        return false;
    }

    return true;
}

export function NotificationBell({ userId, compact = false }: NotificationBellProps) {
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
    const visibleNotifications = useMemo(() => notifications.slice(0, 5), [notifications]);
    const hiddenNotificationCount = Math.max(0, notifications.length - visibleNotifications.length);

    useEffect(() => {
        const baseTitle = document.title.replace(/^\(\d+\)\s+/, '') || 'Durqan';
        document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;

        return () => {
            document.title = baseTitle;
        };
    }, [unreadCount]);

    useEffect(() => {
        const unlock = () => unlockNotificationSound();

        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });

        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
        };
    }, []);

    useEffect(() => {
        const handleNotificationsRead = (event: Event) => {
            const payload = (event as CustomEvent<MarkNotificationsReadPayload>).detail;
            if (!payload) {
                return;
            }

            setNotifications(prev => prev.map(notification =>
                matchesReadPayload(notification, payload)
                    ? { ...notification, is_read: true }
                    : notification
            ));
        };

        window.addEventListener('notifications:read-matching', handleNotificationsRead);
        return () => {
            window.removeEventListener('notifications:read-matching', handleNotificationsRead);
        };
    }, []);

    useEffect(() => {
        if (!userId) {
            setNotifications([]);
            setActorNames({});
            return;
        }

        let cancelled = false;
        setLoading(true);
        setErrorMessage('');

        notificationService.getNotifications()
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

        const source = notificationService.streamNotifications();
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

                if (document.hidden) {
                    playNotificationSound();

                    if ('Notification' in window && Notification.permission === 'granted') {
                        const browserNotification = new Notification(getNotificationTitle(notification), {
                            body: getNotificationDetails(notification),
                            icon: '/favicon.svg',
                            tag: notification.type === 'message_received'
                                ? `message:${notification.conversation_id || notification.actor_id}`
                                : notification.type === 'incoming_call'
                                    ? `call-${notification.call_id || notification.conversation_id || notification.actor_id || notification.id}`
                                    : `notification-${notification.id}`,
                        });

                        browserNotification.onclick = () => {
                            window.focus();
                            navigate(getNotificationURL(notification, userId));
                            browserNotification.close();
                        };
                    }
                }
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
    }, [navigate, userId]);

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
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [open]);

    const navigateToNotification = (notification: SocialNotification) => {
        if (!userId) {
            return;
        }

        navigate(getNotificationURL(notification, userId));
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
                className={`icon-button cursor-pointer relative ${compact ? 'h-9 w-9 sm:h-10 sm:w-10' : 'h-10 w-10'}`}
                title="Уведомления"
                aria-label="Уведомления"
                aria-expanded={open}
                onClick={() => setOpen(prev => !prev)}
            >
                <Icon name="bell" />
                <NotificationBadge count={unreadCount} />
            </button>

            {open && (
                <div className="fixed left-3 right-3 top-16 z-50 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(360px,calc(100vw-24px))]">
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
                            visibleNotifications.map(notification => (
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
                                        <Avatar
                                            name={actorNames[notification.actor_id] || fallbackActorName}
                                            size="sm"
                                        />
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
                        {hiddenNotificationCount > 0 && (
                            <div className="px-4 py-2 text-center text-xs text-gray-400">
                                Показаны последние 5 из {notifications.length}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
