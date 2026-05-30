import React, { useCallback, useEffect, type ReactNode } from 'react';

import { useAuth } from './AuthContext';
import { useUnread } from './UnreadContext';
import { initializePushNotifications } from '../notifications/pushNotifications';
import type { MobileNotificationData } from '../notifications/types';

function isChatNotification(notification: MobileNotificationData) {
  return notification.type === 'message_received';
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { refreshUnreadCount, signalChatDataChanged } = useUnread();

  const handleNotification = useCallback(
    (notification: MobileNotificationData) => {
      if (isChatNotification(notification)) {
        signalChatDataChanged();
        return;
      }

      refreshUnreadCount().catch(() => undefined);
    },
    [refreshUnreadCount, signalChatDataChanged],
  );

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

  return <>{children}</>;
}
