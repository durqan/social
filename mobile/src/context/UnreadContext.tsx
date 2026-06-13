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

import { messageApi } from '../api/messages';
import { chatSocket, type WsEvent } from '../api/ws';
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
  const previousNetworkConnectedRef = useRef(networkConnected);

  const refreshUnreadCount = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    setUnreadLoading(true);
    const refresh = messageApi
      .getUnreadCount()
      .then(count => {
        setUnreadCount(Number(count) || 0);
      })
      .catch(() => {
        // Screen-level API requests show user-facing errors. Unread refresh stays quiet.
      })
      .finally(() => {
        refreshInFlight.current = null;
        setUnreadLoading(false);
      });

    refreshInFlight.current = refresh;
    return refresh;
  }, [user]);

  const signalChatDataChanged = useCallback(() => {
    setChatRefreshVersion(value => value + 1);

    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }

    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refreshUnreadCount().catch(() => undefined);
    }, 300);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }

    chatSocket.recover();
    refreshUnreadCount().catch(() => undefined);
  }, [refreshUnreadCount, user]);

  useAppResumeEffect(() => {
    if (!user) {
      return;
    }

    chatSocket.recover();
    signalChatDataChanged();
  });

  useEffect(() => {
    const wasNetworkConnected = previousNetworkConnectedRef.current;
    previousNetworkConnectedRef.current = networkConnected;

    if (!user || !networkConnected || wasNetworkConnected) {
      return;
    }

    chatSocket.recover();
    signalChatDataChanged();
  }, [networkConnected, signalChatDataChanged, user]);

  useEffect(() => {
    if (!user) {
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
        signalChatDataChanged();
      }
    };

    const unsubscribe = chatSocket.onMessage(handleSocketEvent);
    chatSocket.connect();

    return () => {
      unsubscribe();
    };
  }, [signalChatDataChanged, user]);

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
