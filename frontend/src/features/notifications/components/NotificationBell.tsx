import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
    notificationService,
    type MarkNotificationsReadPayload,
} from "@/features/notifications/api/notificationService.js";
import {
    enablePushNotifications,
    getPushNotificationStatus,
    hasPushSubscription,
    type PushNotificationStatus,
} from "@/features/notifications/api/pushNotifications.js";
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

function pushEnableMessage(reason: string) {
    switch (reason) {
        case 'unconfigured':
            return 'Push не настроены на сервере';
        case 'unsupported':
            return 'Это окружение не поддерживает push. На iPhone откройте приложение с домашнего экрана.';
        case 'denied':
            return 'Push запрещены в настройках iOS/Safari';
        case 'permission-dismissed':
            return 'Разрешение на push не выдано';
        case 'subscription-unavailable':
            return 'Браузер не вернул push-подписку';
        default:
            return 'Не удалось включить push';
    }
}

type PushViewState = 'enabled' | 'disabled' | 'blocked' | 'unsupported';

function pushViewState(status: PushNotificationStatus, subscribed: boolean): PushViewState {
    if (status === 'denied') {
        return 'blocked';
    }
    if (status === 'unsupported' || status === 'unconfigured') {
        return 'unsupported';
    }
    if (status === 'granted' && subscribed) {
        return 'enabled';
    }

    return 'disabled';
}

function pushStatusCopy(status: PushNotificationStatus, subscribed: boolean) {
    const state = pushViewState(status, subscribed);

    if (status === 'unconfigured') {
        return {
            state,
            title: 'Push не настроены',
            description: 'Серверная отправка отключена',
        };
    }

    switch (state) {
        case 'enabled':
            return {
                state,
                title: 'Push включены',
                description: 'Браузерные уведомления активны',
            };
        case 'blocked':
            return {
                state,
                title: 'Push заблокированы',
                description: 'Разрешите уведомления в настройках браузера',
            };
        case 'unsupported':
            return {
                state,
                title: 'Push не поддерживаются',
                description: 'Для iPhone откройте приложение с домашнего экрана',
            };
        default:
            return {
                state,
                title: 'Push отключены',
                description: 'Можно включить уведомления',
            };
    }
}

const pushIndicatorClass: Record<PushViewState, string> = {
    enabled: 'bg-emerald-500 shadow-emerald-500/30',
    disabled: 'bg-gray-400 shadow-gray-400/25',
    blocked: 'bg-red-500 shadow-red-500/30',
    unsupported: 'bg-amber-400 shadow-amber-400/30',
};

const pushContainerClass: Record<PushViewState, string> = {
    enabled: 'border-emerald-100 bg-emerald-50/70',
    disabled: 'border-gray-200 bg-gray-50',
    blocked: 'border-red-100 bg-red-50/70',
    unsupported: 'border-amber-100 bg-amber-50/70',
};

export function NotificationBell({ userId, compact = false }: NotificationBellProps) {
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<SocialNotification[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [pushStatus, setPushStatus] = useState<PushNotificationStatus>(() => getPushNotificationStatus());
    const [pushSubscribed, setPushSubscribed] = useState(false);
    const [pushLoading, setPushLoading] = useState(false);
    const [pushMessage, setPushMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [actorNames, setActorNames] = useState<Record<number, string>>({});
    const rootRef = useRef<HTMLDivElement>(null);
    const pushMessageTimeoutRef = useRef<number | null>(null);

    const unreadCount = useMemo(
        () => notifications.filter(notification => !notification.is_read).length,
        [notifications],
    );
    const visibleNotifications = useMemo(() => notifications.slice(0, 5), [notifications]);
    const hiddenNotificationCount = Math.max(0, notifications.length - visibleNotifications.length);
    const pushCopy = pushStatusCopy(pushStatus, pushSubscribed);

    const setTemporaryPushMessage = useCallback((message: { type: 'success' | 'error'; text: string } | null) => {
        if (pushMessageTimeoutRef.current !== null) {
            window.clearTimeout(pushMessageTimeoutRef.current);
            pushMessageTimeoutRef.current = null;
        }

        setPushMessage(message);

        if (message) {
            pushMessageTimeoutRef.current = window.setTimeout(() => {
                setPushMessage(null);
                pushMessageTimeoutRef.current = null;
            }, 4500);
        }
    }, []);

    const refreshPushState = useCallback(async () => {
        const nextStatus = getPushNotificationStatus();
        setPushStatus(nextStatus);

        if (nextStatus === 'granted') {
            try {
                setPushSubscribed(await hasPushSubscription());
            } catch (error) {
                console.error('Ошибка проверки push-подписки:', error);
                setPushSubscribed(false);
            }
            return;
        }

        setPushSubscribed(false);
    }, []);

    useEffect(() => {
        const baseTitle = document.title.replace(/^\(\d+\)\s+/, '') || 'Durqan';
        document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;

        return () => {
            document.title = baseTitle;
        };
    }, [unreadCount]);

    useEffect(() => {
        return () => {
            if (pushMessageTimeoutRef.current !== null) {
                window.clearTimeout(pushMessageTimeoutRef.current);
            }
        };
    }, []);

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
                            tag: `notification-${notification.id}`,
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

        void refreshPushState();

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
        };
    }, [open, refreshPushState]);

    useEffect(() => {
        const refreshOnVisible = () => {
            if (!document.hidden) {
                void refreshPushState();
            }
        };

        window.addEventListener('focus', refreshOnVisible);
        document.addEventListener('visibilitychange', refreshOnVisible);

        return () => {
            window.removeEventListener('focus', refreshOnVisible);
            document.removeEventListener('visibilitychange', refreshOnVisible);
        };
    }, [refreshPushState]);

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

    const handleEnablePush = async () => {
        if (!userId) {
            return;
        }

        setPushLoading(true);
        setErrorMessage('');
        setTemporaryPushMessage(null);

        try {
            const result = await enablePushNotifications();
            await refreshPushState();
            setTemporaryPushMessage(result.ok
                ? { type: 'success', text: 'Push-уведомления включены' }
                : { type: 'error', text: pushEnableMessage(result.reason) });
        } catch (error) {
            console.error('Ошибка подключения push-уведомлений:', error);
            setTemporaryPushMessage({ type: 'error', text: 'Не удалось сохранить push-подписку' });
            await refreshPushState();
        } finally {
            setPushLoading(false);
        }
    };

    const handleCheckPush = async () => {
        if (!userId) {
            return;
        }

        setPushLoading(true);
        setTemporaryPushMessage(null);

        try {
            const status = getPushNotificationStatus();
            if (status === 'granted') {
                const result = await enablePushNotifications();
                await refreshPushState();
                setTemporaryPushMessage(result.ok
                    ? { type: 'success', text: 'Push-подписка активна' }
                    : { type: 'error', text: pushEnableMessage(result.reason) });
                return;
            }

            await refreshPushState();
            setTemporaryPushMessage({ type: 'error', text: pushEnableMessage(status) });
        } catch (error) {
            console.error('Ошибка проверки push-уведомлений:', error);
            await refreshPushState();
            setTemporaryPushMessage({ type: 'error', text: 'Не удалось проверить push' });
        } finally {
            setPushLoading(false);
        }
    };

    const handleBlockedPushHelp = () => {
        setTemporaryPushMessage({
            type: 'error',
            text: 'Откройте настройки сайта в браузере и разрешите уведомления',
        });
    };

    const pushAction = pushCopy.state === 'enabled'
        ? { label: 'Проверить', onClick: handleCheckPush }
        : pushCopy.state === 'disabled'
            ? { label: 'Включить', onClick: handleEnablePush }
            : pushCopy.state === 'blocked'
                ? { label: 'Настройки', onClick: handleBlockedPushHelp }
                : null;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                className={`icon-button relative ${compact ? 'h-9 w-9 sm:h-10 sm:w-10' : 'h-10 w-10'}`}
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

                    <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
                        <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${pushContainerClass[pushCopy.state]}`}>
                            <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm">
                                <Icon name="bell" className="h-4 w-4" />
                                <span className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full shadow-md ${pushIndicatorClass[pushCopy.state]}`} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-gray-950">{pushCopy.title}</span>
                                <span className="block truncate text-xs text-gray-500">{pushCopy.description}</span>
                            </span>
                            {pushAction && (
                                <button
                                    type="button"
                                    onClick={pushAction.onClick}
                                    disabled={pushLoading}
                                    className="flex-shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                                >
                                    {pushLoading ? '...' : pushAction.label}
                                </button>
                            )}
                        </div>
                        {pushMessage && (
                            <div className={`mt-2 rounded-lg px-2 py-1.5 text-xs ${
                                pushMessage.type === 'success'
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-red-50 text-red-600'
                            }`}>
                                {pushMessage.text}
                            </div>
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
                                            userId={notification.actor_id}
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
