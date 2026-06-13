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

import { useAuth } from './AuthContext';
import { useUnread } from './UnreadContext';
import {
  notificationsApi,
  type MarkNotificationsReadPayload,
} from '../api/notifications';
import { getApiErrorMessage } from '../api/http';
import type { SocialNotification } from '../api/types';
import { initializePushNotifications } from '../notifications/pushNotifications';
import type { MobileNotificationData } from '../notifications/types';

type NotificationsContextValue = {
  notifications: SocialNotification[];
  unreadNotificationCount: number;
  loading: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: number) => Promise<void>;
  markMatchingAsRead: (payload: MarkNotificationsReadPayload) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | undefined>(
  undefined,
);

function isChatNotification(notification: MobileNotificationData) {
  return notification.type === 'message_received';
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const unreadNotificationCount = useMemo(
    () => notifications.filter(notification => !notification.is_read).length,
    [notifications],
  );

  const refreshNotifications = useCallback(async () => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    setLoading(true);
    setError(null);
    const refresh = notificationsApi
      .getNotifications()
      .then(nextNotifications => {
        setNotifications(
          Array.isArray(nextNotifications) ? nextNotifications : [],
        );
      })
      .catch(apiError => {
        setError(getApiErrorMessage(apiError));
      })
      .finally(() => {
        refreshInFlight.current = null;
        setLoading(false);
      });

    refreshInFlight.current = refresh;
    return refresh;
  }, [user?.id]);

  const markAsRead = useCallback(async (notificationId: number) => {
    await notificationsApi.markAsRead(notificationId);
    setNotifications(previous =>
      previous.map(notification =>
        notification.id === notificationId
          ? { ...notification, is_read: true }
          : notification,
      ),
    );
  }, []);

  const markMatchingAsRead = useCallback(
    async (payload: MarkNotificationsReadPayload) => {
      await notificationsApi.markMatchingAsRead(payload);
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

          return typeMatches && actorMatches && entityMatches
            ? { ...notification, is_read: true }
            : notification;
        }),
      );
    },
    [],
  );

  const handleNotification = useCallback(
    (notification: MobileNotificationData) => {
      if (isChatNotification(notification)) {
        signalChatDataChanged();
      }

      refreshUnreadCount().catch(() => undefined);
      refreshNotifications().catch(() => undefined);
    },
    [refreshNotifications, refreshUnreadCount, signalChatDataChanged],
  );

  useEffect(() => {
    refreshNotifications().catch(() => undefined);
  }, [refreshNotifications]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let mounted = true;
    let cleanup: (() => void) | undefined;

    initializePushNotifications({
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
  }, [handleNotification, user?.id]);

  const value = useMemo(
    () => ({
      notifications,
      unreadNotificationCount,
      loading,
      error,
      refreshNotifications,
      markAsRead,
      markMatchingAsRead,
    }),
    [
      error,
      loading,
      markAsRead,
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
    throw new Error('useNotifications must be used inside NotificationsProvider');
  }
  return value;
}
