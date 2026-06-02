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
import { chatSocket, type WsEvent } from '../api/ws';
import { useAuth } from './AuthContext';
import { useAppLifecycle } from './AppLifecycleContext';

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
  const { isForeground, networkConnected, resumeCount } = useAppLifecycle();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadLoading, setUnreadLoading] = useState(false);
  const [chatRefreshVersion, setChatRefreshVersion] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

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

  useEffect(() => {
    if (!user || !isForeground) {
      return;
    }

    chatSocket.recover();
    signalChatDataChanged();
  }, [isForeground, resumeCount, signalChatDataChanged, user]);

  useEffect(() => {
    if (!user || !networkConnected) {
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
        event.type === 'message:new' ||
        event.type === 'message:update' ||
        event.type === 'message:delete' ||
        event.type === 'message:read'
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
