import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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

type NotificationListItem = {
  notification: SocialNotification;
  count: number;
  seenIds: number[];
};

const fallbackActorName = "Пользователь";
const markSeenDelayMs = 750;

const notificationText: Record<string, (actorName: string) => string> = {
  post_liked: (actorName) => `${actorName} лайкнул(а) ваш пост`,
  comment_created: (actorName) => `${actorName} прокомментировал(а) ваш пост`,
  friend_request: (actorName) => `${actorName} отправил(а) заявку в друзья`,
  friend_accepted: (actorName) => `${actorName} принял(а) вашу заявку`,
  message_received: (actorName) => `${actorName} написал(а) вам`,
  incoming_call: (actorName) => `${actorName} звонил(а) вам`,
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
  if (audioContext.state === "suspended") {
    audioContext.resume().catch((error) => {
      console.error("Ошибка включения звука уведомлений:", error);
    });
  }
}

function playNotificationSound() {
  try {
    const audioContext = getNotificationAudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "sine";
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
    console.error("Ошибка проигрывания звука уведомления:", error);
  }
}

function getNotificationTitle(
  notification: SocialNotification,
  actorName?: string,
) {
  const buildTitle = notificationText[notification.type];
  if (!buildTitle) {
    return "Новое уведомление";
  }

  return buildTitle(actorName || fallbackActorName);
}

function getNotificationListTitle(
  item: NotificationListItem,
  actorName?: string,
) {
  if (item.notification.type === "message_received" && item.count > 1) {
    return `${actorName || fallbackActorName}: ${item.count} новых сообщений`;
  }

  return getNotificationTitle(item.notification, actorName);
}

function getNotificationDetails(notification: SocialNotification) {
  switch (notification.type) {
    case "message_received":
      return "Открыть чат";
    case "incoming_call":
      return "Открыть чат";
    case "friend_request":
      return "Открыть заявки в друзья";
    case "friend_accepted":
      return "Открыть профиль";
    case "post_liked":
    case "comment_created":
      return "Открыть стену";
    default:
      return "Открыть";
  }
}

function getNotificationURL(notification: SocialNotification, userId: number) {
  switch (notification.type) {
    case "message_received":
      return `/users/${userId}/chat/${notification.conversation_id || notification.actor_id}`;
    case "incoming_call":
      return `/users/${userId}/chat/${notification.conversation_id || notification.actor_id}`;
    case "friend_request":
      return `/users/${userId}/friends`;
    case "friend_accepted":
      return `/users/${notification.actor_id}`;
    case "post_liked":
    case "comment_created":
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
      {count > 99 ? "99+" : count}
    </span>
  );
}

function matchesReadPayload(
  notification: SocialNotification,
  payload: MarkNotificationsReadPayload,
) {
  if (payload.types.length > 0 && !payload.types.includes(notification.type)) {
    return false;
  }
  if (
    payload.actor_id !== undefined &&
    notification.actor_id !== payload.actor_id
  ) {
    return false;
  }
  if (
    payload.entity_id !== undefined &&
    notification.entity_id !== payload.entity_id
  ) {
    return false;
  }
  if (
    payload.conversation_id !== undefined &&
    notification.conversation_id !== payload.conversation_id &&
    notification.actor_id !== payload.conversation_id
  ) {
    return false;
  }

  return true;
}

function messageConversationId(notification: SocialNotification) {
  return notification.conversation_id || notification.actor_id;
}

function isChatPath(conversationId: number) {
  return new RegExp(`/chat/${conversationId}(?:$|[/?#])`).test(
    window.location.pathname,
  );
}

export function notificationSeenIdsForVisibleItems(
  notifications: SocialNotification[],
  visibleItems: NotificationListItem[],
) {
  const ids = new Set<number>();
  const visibleMessageConversations = new Set(
    visibleItems
      .filter((item) => item.notification.type === "message_received")
      .map((item) => messageConversationId(item.notification))
      .filter(Boolean),
  );

  visibleItems.forEach((item) => {
    item.seenIds.forEach((id) => ids.add(id));
  });

  notifications.forEach((notification) => {
    if (
      notification.type === "message_received" &&
      visibleMessageConversations.has(messageConversationId(notification))
    ) {
      ids.add(notification.id);
    }
  });

  return Array.from(ids);
}

export function groupNotificationsForDisplay(
  notifications: SocialNotification[],
): NotificationListItem[] {
  const grouped: NotificationListItem[] = [];
  const messageGroups = new Map<number, NotificationListItem>();

  notifications.forEach((notification) => {
    if (notification.type !== "message_received") {
      grouped.push({
        notification,
        count: 1,
        seenIds: [notification.id],
      });
      return;
    }

    const conversationId = messageConversationId(notification);
    const existing = messageGroups.get(conversationId);
    if (existing) {
      existing.count += 1;
      existing.seenIds.push(notification.id);
      if (
        new Date(notification.created_at).getTime() >
        new Date(existing.notification.created_at).getTime()
      ) {
        existing.notification = notification;
      }
      return;
    }

    const item = {
      notification,
      count: 1,
      seenIds: [notification.id],
    };
    messageGroups.set(conversationId, item);
    grouped.push(item);
  });

  return grouped;
}

export function countUnseenNotificationBadge(
  notifications: SocialNotification[],
) {
  const unseenIds = new Set(
    notifications
      .filter((notification) => !notification.is_seen)
      .map((notification) => notification.id),
  );

  return groupNotificationsForDisplay(notifications).filter((item) =>
    item.seenIds.some((id) => unseenIds.has(id)),
  ).length;
}

export function NotificationBell({
  userId,
  compact = false,
}: NotificationBellProps) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [actorNames, setActorNames] = useState<Record<number, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  const unseenCount = useMemo(
    () => countUnseenNotificationBadge(notifications),
    [notifications],
  );
  const displayNotifications = useMemo(
    () => groupNotificationsForDisplay(notifications),
    [notifications],
  );
  const visibleNotifications = useMemo(
    () => displayNotifications.slice(0, 5),
    [displayNotifications],
  );
  const hiddenNotificationCount = Math.max(
    0,
    displayNotifications.length - visibleNotifications.length,
  );

  useEffect(() => {
    const baseTitle = document.title.replace(/^\(\d+\)\s+/, "") || "Durqan";
    document.title =
      unseenCount > 0 ? `(${unseenCount}) ${baseTitle}` : baseTitle;

    return () => {
      document.title = baseTitle;
    };
  }, [unseenCount]);

  useEffect(() => {
    const unlock = () => unlockNotificationSound();

    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const handleNotificationsRead = (event: Event) => {
      const payload = (event as CustomEvent<MarkNotificationsReadPayload>)
        .detail;
      if (!payload) {
        return;
      }

      setNotifications((prev) =>
        prev.map((notification) =>
          matchesReadPayload(notification, payload)
            ? { ...notification, is_read: true, is_seen: true }
            : notification,
        ),
      );
    };

    window.addEventListener(
      "notifications:read-matching",
      handleNotificationsRead,
    );
    return () => {
      window.removeEventListener(
        "notifications:read-matching",
        handleNotificationsRead,
      );
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
    setErrorMessage("");

    notificationService
      .getNotifications()
      .then((data) => {
        if (!cancelled) {
          setNotifications(Array.isArray(data) ? data : []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Ошибка загрузки уведомлений:", error);
          setErrorMessage("Не удалось загрузить уведомления");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    const source = notificationService.streamNotifications();
    source.onmessage = (event) => {
      try {
        const notification = JSON.parse(event.data) as SocialNotification;
        const conversationId = messageConversationId(notification);
        const isActiveMessageChat =
          notification.type === "message_received" &&
          isChatPath(conversationId);
        const nextNotification = isActiveMessageChat
          ? { ...notification, is_read: true, is_seen: true }
          : notification;
        setErrorMessage("");
        setNotifications((prev) => {
          if (prev.some((item) => item.id === nextNotification.id)) {
            return prev;
          }
          return [nextNotification, ...prev];
        });

        if (isActiveMessageChat) {
          notificationService
            .markMatchingAsRead({
              types: ["message_received"],
              conversation_id: conversationId,
            })
            .catch((error) => {
              console.error(
                "Ошибка отметки уведомления активного чата:",
                error,
              );
            });
          return;
        }

        if (document.hidden) {
          playNotificationSound();

          if (
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const browserNotification = new Notification(
              getNotificationTitle(notification),
              {
                body: getNotificationDetails(notification),
                icon: "/favicon.svg",
                tag:
                  notification.type === "message_received"
                    ? `message:${notification.conversation_id || notification.actor_id}`
                    : notification.type === "incoming_call"
                      ? `call-${notification.call_id || notification.conversation_id || notification.actor_id || notification.id}`
                      : `notification-${notification.id}`,
              },
            );

            browserNotification.onclick = () => {
              window.focus();
              navigate(getNotificationURL(notification, userId));
              browserNotification.close();
            };
          }
        }
      } catch (error) {
        console.error("Ошибка разбора уведомления:", error);
      }
    };
    source.onerror = (error) => {
      console.error("Ошибка SSE уведомлений:", error);
      setErrorMessage("Нет realtime-подключения");
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [navigate, userId]);

  useEffect(() => {
    if (!open || visibleNotifications.length === 0) {
      return;
    }

    const ids = notificationSeenIdsForVisibleItems(
      notifications,
      visibleNotifications,
    ).filter((id) =>
      notifications.some(
        (notification) => notification.id === id && !notification.is_seen,
      ),
    );
    if (ids.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      notificationService
        .markAsSeen(ids)
        .then(() => {
          setNotifications((prev) =>
            prev.map((notification) =>
              ids.includes(notification.id)
                ? { ...notification, is_seen: true }
                : notification,
            ),
          );
        })
        .catch((error) => {
          console.error("Ошибка отметки уведомлений просмотренными:", error);
        });
    }, markSeenDelayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notifications, open, visibleNotifications]);

  useEffect(() => {
    const missingActorIds = Array.from(
      new Set(
        notifications
          .map((notification) => notification.actor_id)
          .filter((actorID) => actorID > 0 && !actorNames[actorID]),
      ),
    );

    if (missingActorIds.length === 0) {
      return;
    }

    let cancelled = false;

    missingActorIds.forEach((actorID) => {
      userService
        .getUser(actorID)
        .then((user) => {
          if (cancelled) {
            return;
          }

          setActorNames((prev) => ({
            ...prev,
            [actorID]: user.name || fallbackActorName,
          }));
        })
        .catch((error) => {
          console.error("Ошибка загрузки автора уведомления:", error);
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

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
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

    setNotifications((prev) =>
      prev.map((item) =>
        item.id === notification.id
          ? { ...item, is_read: true, is_seen: true }
          : item,
      ),
    );

    try {
      await notificationService.markAsRead(notification.id);
    } catch (error) {
      console.error("Ошибка отметки уведомления:", error);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id
            ? {
                ...item,
                is_read: notification.is_read,
                is_seen: notification.is_seen,
              }
            : item,
        ),
      );
    }

    navigateToNotification(notification);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`icon-button cursor-pointer relative ${compact ? "h-9 w-9 sm:h-10 sm:w-10" : "h-10 w-10"}`}
        title="Уведомления"
        aria-label="Уведомления"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Icon name="bell" />
        <NotificationBadge count={unseenCount} />
      </button>

      {open && (
        <div className="fixed left-3 right-3 top-16 z-50 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(360px,calc(100vw-24px))]">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="font-semibold text-gray-950">Уведомления</p>
            {unseenCount > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                {unseenCount}
              </span>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {errorMessage && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-red-500">
                {errorMessage}
              </div>
            ) : loading && notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                Загрузка...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                Нет уведомлений
              </div>
            ) : (
              visibleNotifications.map((item) => {
                const notification = item.notification;
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 hover:bg-gray-50 ${
                      notification.is_read ? "bg-white" : "bg-sky-50/70"
                    }`}
                  >
                    <div className="flex gap-3">
                      <span
                        className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                          notification.is_read ? "bg-gray-300" : "bg-sky-500"
                        }`}
                      />
                      <Avatar
                        name={
                          actorNames[notification.actor_id] || fallbackActorName
                        }
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-gray-950">
                          {getNotificationListTitle(
                            item,
                            actorNames[notification.actor_id],
                          )}
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
                );
              })
            )}
            {hiddenNotificationCount > 0 && (
              <div className="px-4 py-2 text-center text-xs text-gray-400">
                Показаны последние 5 из {displayNotifications.length}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
