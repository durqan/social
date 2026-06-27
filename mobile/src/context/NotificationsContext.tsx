import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { WS_EVENTS } from '@social/shared';

import { useAppLifecycle } from './AppLifecycleContext';
import { useAuth } from './AuthContext';
import { useUnread } from './UnreadContext';
import {
  notificationsApi,
  type MarkNotificationsReadPayload,
} from '../api/notifications';
import { getApiErrorMessage } from '../api/http';
import { chatSocket, type WsEvent } from '../api/ws';
import type { SocialNotification } from '../api/types';
import { initializePushNotifications } from '../notifications/pushNotifications';
import type { MobileNotificationData } from '../notifications/types';
import {
  applyPushNotificationEffects,
  drainPendingPushEvents,
} from '../notifications/pushEffects';

type NotificationsContextValue = {
  notifications: SocialNotification[];
  unreadNotificationCount: number;
  loading: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: number) => Promise<void>;
  markAsSeen: (notificationIds: number[]) => Promise<void>;
  markMatchingAsRead: (payload: MarkNotificationsReadPayload) => Promise<void>;
};

const NotificationsContext = createContext<
  NotificationsContextValue | undefined
>(undefined);

function notificationMatchesConversation(
  notification: SocialNotification,
  conversationId: number,
) {
  return (
    notification.type === 'message_received' &&
    (notification.conversation_id === conversationId ||
      notification.actor_id === conversationId)
  );
}

function countUnseenNotificationBadge(notifications: SocialNotification[]) {
  return notifications.filter(notification => !notification.is_seen).length;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { resumeCount } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshInFlightUserId = useRef<number | null>(null);
  const refreshSeq = useRef(0);
  const userId = user?.id ?? null;
  const currentUserIdRef = useRef(userId);

  useEffect(() => {
    currentUserIdRef.current = userId;
  }, [userId]);

  const unreadNotificationCount = useMemo(
    () => countUnseenNotificationBadge(notifications),
    [notifications],
  );

  const refreshNotifications = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    if (refreshInFlight.current && refreshInFlightUserId.current === userId) {
      return refreshInFlight.current;
    }

    const requestSeq = ++refreshSeq.current;
    refreshInFlightUserId.current = userId;
    setLoading(true);
    setError(null);
    const refresh = notificationsApi
      .getNotifications()
      .then(nextNotifications => {
        if (
          refreshSeq.current !== requestSeq ||
          refreshInFlightUserId.current !== userId
        ) {
          return;
        }
        setNotifications(
          Array.isArray(nextNotifications) ? nextNotifications : [],
        );
      })
      .catch(apiError => {
        if (refreshSeq.current === requestSeq) {
          setError(getApiErrorMessage(apiError));
        }
      })
      .finally(() => {
        if (refreshInFlight.current === refresh) {
          refreshInFlight.current = null;
          refreshInFlightUserId.current = null;
        }
        if (refreshSeq.current === requestSeq) {
          setLoading(false);
        }
      });

    refreshInFlight.current = refresh;
    return refresh;
  }, [userId]);

  const markAsRead = useCallback(
    async (notificationId: number) => {
      const requestUserId = userId;
      await notificationsApi.markAsRead(notificationId);
      if (!requestUserId || requestUserId !== currentUserIdRef.current) {
        return;
      }
      setNotifications(previous =>
        previous.map(notification =>
          notification.id === notificationId
            ? { ...notification, is_read: true, is_seen: true }
            : notification,
        ),
      );
    },
    [userId],
  );

  const markAsSeen = useCallback(
    async (notificationIds: number[]) => {
      if (notificationIds.length === 0) {
        return;
      }

      const requestUserId = userId;
      await notificationsApi.markAsSeen(notificationIds);
      if (!requestUserId || requestUserId !== currentUserIdRef.current) {
        return;
      }
      const seenIds = new Set(notificationIds);
      setNotifications(previous =>
        previous.map(notification =>
          seenIds.has(notification.id)
            ? { ...notification, is_seen: true }
            : notification,
        ),
      );
    },
    [userId],
  );

  const markMatchingAsRead = useCallback(
    async (payload: MarkNotificationsReadPayload) => {
      const requestUserId = userId;
      await notificationsApi.markMatchingAsRead(payload);
      if (!requestUserId || requestUserId !== currentUserIdRef.current) {
        return;
      }
      setNotifications(previous =>
        previous.map(notification => {
          const typeMatches =
            payload.types.length === 0 ||
            payload.types.includes(notification.type);
          const actorMatches =
            payload.actor_id === undefined ||
            payload.actor_id === notification.actor_id;
          const entityMatches =
            payload.entity_id === undefined ||
            payload.entity_id === notification.entity_id;
          const conversationMatches =
            payload.conversation_id === undefined ||
            payload.conversation_id === notification.conversation_id ||
            payload.conversation_id === notification.actor_id;

          return typeMatches &&
            actorMatches &&
            entityMatches &&
            conversationMatches
            ? { ...notification, is_read: true, is_seen: true }
            : notification;
        }),
      );
    },
    [userId],
  );

  const markConversationNotificationsRead = useCallback(
    (conversationId?: number) => {
      if (!conversationId) {
        return;
      }

      setNotifications(previous =>
        previous.map(notification =>
          notificationMatchesConversation(notification, conversationId)
            ? { ...notification, is_read: true, is_seen: true }
            : notification,
        ),
      );
    },
    [],
  );

  const handleNotification = useCallback(
    (notification: MobileNotificationData) => {
      applyPushNotificationEffects(notification, {
        markConversationRead: markConversationNotificationsRead,
        refreshNotifications,
        refreshUnreadCount,
        signalChatDataChanged,
      });
    },
    [
      markConversationNotificationsRead,
      refreshNotifications,
      refreshUnreadCount,
      signalChatDataChanged,
    ],
  );

  useEffect(() => {
    if (!userId) {
      return;
    }

    drainPendingPushEvents()
      .then(events => {
        events.forEach(event => handleNotification(event.notification));
      })
      .catch(() => undefined);
  }, [handleNotification, resumeCount, userId]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    const unsubscribe = chatSocket.onMessage((event: WsEvent) => {
      if (event.type !== WS_EVENTS.CONVERSATION_READ) {
        return;
      }

      const payload = event.payload as {
        reader_id?: number;
        conversation_id?: number;
      };
      if (payload.reader_id !== userId) {
        return;
      }

      markConversationNotificationsRead(payload.conversation_id);
      refreshNotifications().catch(() => undefined);
    });

    return unsubscribe;
  }, [markConversationNotificationsRead, refreshNotifications, userId]);

  useEffect(() => {
    if (!userId) {
      refreshSeq.current += 1;
      refreshInFlight.current = null;
      refreshInFlightUserId.current = null;
      setNotifications([]);
      setLoading(false);
      setError(null);
      return;
    }

    refreshNotifications().catch(() => undefined);
  }, [refreshNotifications, userId]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    let mounted = true;
    let cleanup: (() => void) | undefined;

    initializePushNotifications({
      userId,
      onNotification: handleNotification,
      onNotificationOpen: handleNotification,
    }).then(nextCleanup => {
      if (mounted) {
        cleanup = nextCleanup;
      } else {
        nextCleanup();
      }
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [handleNotification, userId]);

  const value = useMemo(
    () => ({
      notifications,
      unreadNotificationCount,
      loading,
      error,
      refreshNotifications,
      markAsRead,
      markAsSeen,
      markMatchingAsRead,
    }),
    [
      error,
      loading,
      markAsRead,
      markAsSeen,
      markMatchingAsRead,
      notifications,
      refreshNotifications,
      unreadNotificationCount,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error(
      'useNotifications must be used inside NotificationsProvider',
    );
  }
  return value;
}
