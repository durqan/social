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

import { messageApi } from '../api/messages';
import { WS_EVENTS, chatSocket, type WsEvent } from '../api/ws';
import { useAuth } from './AuthContext';
import { useAppLifecycle } from './AppLifecycleContext';
import { useAppResumeEffect } from '../utils/useAppResumeEffect';

type UnreadContextValue = {
  unreadCount: number;
  unreadLoading: boolean;
  chatRefreshVersion: number;
  refreshUnreadCount: () => Promise<void>;
  signalChatDataChanged: () => void;
};

const UnreadContext = createContext<UnreadContextValue | undefined>(undefined);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { networkConnected } = useAppLifecycle();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadLoading, setUnreadLoading] = useState(false);
  const [chatRefreshVersion, setChatRefreshVersion] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshInFlightUserId = useRef<number | null>(null);
  const refreshSeq = useRef(0);
  const previousNetworkConnectedRef = useRef(networkConnected);
  const userId = user?.id ?? null;

  const refreshUnreadCount = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    if (refreshInFlight.current && refreshInFlightUserId.current === userId) {
      return refreshInFlight.current;
    }

    const requestSeq = ++refreshSeq.current;
    refreshInFlightUserId.current = userId;
    setUnreadLoading(true);
    const refresh = messageApi
      .getUnreadCount()
      .then(count => {
        if (
          refreshSeq.current === requestSeq &&
          refreshInFlightUserId.current === userId
        ) {
          setUnreadCount(Number(count) || 0);
        }
      })
      .catch(() => {
        // Screen-level API requests show user-facing errors. Unread refresh stays quiet.
      })
      .finally(() => {
        if (refreshInFlight.current === refresh) {
          refreshInFlight.current = null;
          refreshInFlightUserId.current = null;
        }
        if (refreshSeq.current === requestSeq) {
          setUnreadLoading(false);
        }
      });

    refreshInFlight.current = refresh;
    return refresh;
  }, [userId]);

  const scheduleUnreadRefresh = useCallback(() => {
    if (!userId) {
      return;
    }

    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refreshUnreadCount().catch(() => undefined);
    }, 300);
  }, [refreshUnreadCount, userId]);

  const signalChatDataChanged = useCallback(() => {
    if (!userId) {
      return;
    }
    // While realtime is connected, conversation:delta owns list updates. A
    // full page resync is only needed when the mutation/push happened without
    // a live socket.
    if (!chatSocket.isConnected()) {
      setChatRefreshVersion(value => value + 1);
    }
    scheduleUnreadRefresh();
  }, [scheduleUnreadRefresh, userId]);

  useEffect(() => {
    if (!userId) {
      refreshSeq.current += 1;
      refreshInFlight.current = null;
      refreshInFlightUserId.current = null;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      setUnreadCount(0);
      setUnreadLoading(false);
      setChatRefreshVersion(0);
      return;
    }

    refreshUnreadCount().catch(() => undefined);
  }, [refreshUnreadCount, userId]);

  useAppResumeEffect(() => {
    if (!userId) {
      return;
    }

    signalChatDataChanged();
  });

  useEffect(() => {
    const wasNetworkConnected = previousNetworkConnectedRef.current;
    previousNetworkConnectedRef.current = networkConnected;

    if (!userId || !networkConnected || wasNetworkConnected) {
      return;
    }

    signalChatDataChanged();
  }, [networkConnected, signalChatDataChanged, userId]);

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    const handleSocketEvent = (event: WsEvent) => {
      if (
        event.type === WS_EVENTS.MESSAGE_NEW ||
        event.type === WS_EVENTS.MESSAGE_UPDATE ||
        event.type === WS_EVENTS.MESSAGE_DELETE ||
        event.type === WS_EVENTS.MESSAGE_READ ||
        event.type === WS_EVENTS.CONVERSATION_READ
      ) {
        scheduleUnreadRefresh();
      }
    };

    const unsubscribe = chatSocket.onMessage(handleSocketEvent);

    return () => {
      unsubscribe();
    };
  }, [scheduleUnreadRefresh, userId]);

  useEffect(
    () => () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      unreadCount,
      unreadLoading,
      chatRefreshVersion,
      refreshUnreadCount,
      signalChatDataChanged,
    }),
    [
      chatRefreshVersion,
      refreshUnreadCount,
      signalChatDataChanged,
      unreadCount,
      unreadLoading,
    ],
  );

  return (
    <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>
  );
}

export function useUnread() {
  const value = useContext(UnreadContext);
  if (!value) {
    throw new Error('useUnread must be used inside UnreadProvider');
  }
  return value;
}
