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
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
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

function notificationMatchesReadRequest(
  notification: SocialNotification,
  payload: MarkNotificationsReadPayload,
) {
  return (
    (payload.types.length === 0 || payload.types.includes(notification.type)) &&
    (payload.actor_id === undefined ||
      payload.actor_id === notification.actor_id) &&
    (payload.entity_id === undefined ||
      payload.entity_id === notification.entity_id) &&
    (payload.conversation_id === undefined ||
      payload.conversation_id === notification.conversation_id ||
      payload.conversation_id === notification.actor_id)
  );
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { resumeCount } = useAppLifecycle();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshInFlightUserId = useRef<number | null>(null);
  const refreshSeq = useRef(0);
  const userId = user?.id ?? null;
  const currentUserIdRef = useRef(userId);
  const nextCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = userId;
  }, [userId]);

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
      .getNotificationsPage({ limit: 30 })
      .then(page => {
        if (
          refreshSeq.current !== requestSeq ||
          refreshInFlightUserId.current !== userId
        ) {
          return;
        }
        setNotifications(page.notifications);
        nextCursorRef.current = page.next_cursor;
        setHasMore(page.has_more);
        setUnreadNotificationCount(page.unseen_count);
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

  const loadMoreNotifications = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!userId || !cursor || loadMoreInFlightRef.current) {
      return;
    }
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    const requestSeq = refreshSeq.current;
    try {
      const page = await notificationsApi.getNotificationsPage({
        limit: 30,
        cursor,
      });
      if (
        requestSeq !== refreshSeq.current ||
        userId !== currentUserIdRef.current
      ) {
        return;
      }
      setNotifications(previous => {
        const seen = new Set(previous.map(item => item.id));
        const appended = page.notifications.filter(item => !seen.has(item.id));
        return [...previous, ...appended].slice(0, 200);
      });
      nextCursorRef.current = page.next_cursor;
      setHasMore(page.has_more && page.notifications.length > 0);
      setUnreadNotificationCount(page.unseen_count);
    } catch (apiError) {
      setError(getApiErrorMessage(apiError));
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
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
      const target = notifications.find(item => item.id === notificationId);
      if (target && !target.is_seen) {
        setUnreadNotificationCount(count => Math.max(0, count - 1));
      }
    },
    [notifications, userId],
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
      const newlySeen = notifications.filter(
        notification => seenIds.has(notification.id) && !notification.is_seen,
      ).length;
      setNotifications(previous =>
        previous.map(notification =>
          seenIds.has(notification.id)
            ? { ...notification, is_seen: true }
            : notification,
        ),
      );
      if (newlySeen > 0) {
        setUnreadNotificationCount(count => Math.max(0, count - newlySeen));
      }
    },
    [notifications, userId],
  );

  const markMatchingAsRead = useCallback(
    async (payload: MarkNotificationsReadPayload) => {
      const requestUserId = userId;
      await notificationsApi.markMatchingAsRead(payload);
      if (!requestUserId || requestUserId !== currentUserIdRef.current) {
        return;
      }
      setNotifications(previous =>
        previous.map(notification =>
          notificationMatchesReadRequest(notification, payload)
            ? { ...notification, is_read: true, is_seen: true }
            : notification,
        ),
      );
      const newlySeen = notifications.filter(
        notification =>
          !notification.is_seen &&
          notificationMatchesReadRequest(notification, payload),
      ).length;
      if (newlySeen > 0) {
        setUnreadNotificationCount(count => Math.max(0, count - newlySeen));
      }
    },
    [notifications, userId],
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
      const newlySeen = notifications.filter(
        notification =>
          !notification.is_seen &&
          notificationMatchesConversation(notification, conversationId),
      ).length;
      if (newlySeen > 0) {
        setUnreadNotificationCount(count => Math.max(0, count - newlySeen));
      }
    },
    [notifications],
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
      nextCursorRef.current = null;
      setHasMore(false);
      setLoadingMore(false);
      setUnreadNotificationCount(0);
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
      loadingMore,
      hasMore,
      error,
      refreshNotifications,
      loadMoreNotifications,
      markAsRead,
      markAsSeen,
      markMatchingAsRead,
    }),
    [
      error,
      hasMore,
      loading,
      loadingMore,
      loadMoreNotifications,
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
