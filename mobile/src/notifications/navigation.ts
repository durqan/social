import { createNavigationContainerRef } from '@react-navigation/native';

import type { MainStackParamList } from '../navigation/types';
import type { MobileNotificationData } from './types';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

let pendingNotification: MobileNotificationData | null = null;

function actorFromChatURL(url?: string) {
  if (!url) {
    return undefined;
  }

  const match = url.match(/\/chat\/(\d+)/);
  if (!match) {
    return undefined;
  }

  const actorId = Number(match[1]);
  return Number.isFinite(actorId) ? actorId : undefined;
}

function navigateNow(notification: MobileNotificationData) {
  const actorId = notification.actorId ?? actorFromChatURL(notification.url);

  switch (notification.type) {
    case 'message_received':
      if (actorId) {
        navigationRef.navigate('MainTabs', {
          screen: 'Chats',
          params: {
            screen: 'Chat',
            params: {
              userId: actorId,
              name: 'Чат',
            },
          },
        });
        return;
      }
      navigationRef.navigate('MainTabs', {
        screen: 'Chats',
        params: {
          screen: 'ChatList',
        },
      });
      return;
    case 'friend_request':
      navigationRef.navigate('MainTabs', {
        screen: 'Friends',
      });
      return;
    case 'friend_accepted':
      if (actorId) {
        navigationRef.navigate('UserProfile', {
          userId: actorId,
          name: 'Профиль',
        });
        return;
      }
      navigationRef.navigate('MainTabs', {
        screen: 'Friends',
      });
      return;
    default:
      navigationRef.navigate('MainTabs', {
        screen: 'Notifications',
      });
  }
}

export function navigateFromNotification(notification: MobileNotificationData) {
  if (!navigationRef.isReady()) {
    pendingNotification = notification;
    return;
  }

  navigateNow(notification);
}

export function flushPendingNotificationNavigation() {
  if (!pendingNotification || !navigationRef.isReady()) {
    return;
  }

  const notification = pendingNotification;
  pendingNotification = null;
  navigateNow(notification);
}
