import { createNavigationContainerRef } from '@react-navigation/native';

import type { MainStackParamList } from '../navigation/types';
import type { MobileNotificationData } from './types';
import { rememberPendingIncomingCall } from './pendingIncomingCall';

export const navigationRef = createNavigationContainerRef<MainStackParamList>();

let pendingNotification: MobileNotificationData | null = null;

type NotificationRoute =
  | {
      kind: 'chat';
      userId: number;
      name: string;
      incomingCall?: boolean;
      callId?: string;
    }
  | {
      kind: 'chatList';
    }
  | {
      kind: 'tab';
      tab: 'Home' | 'Friends' | 'Profile' | 'Settings';
    }
  | {
      kind: 'userProfile';
      userId: number;
      name?: string;
    };

export function notificationRouteFromPayload(
  notification: MobileNotificationData,
  options: {
    actorName?: string;
  } = {},
): NotificationRoute {
  const actorId = notification.actorId ?? notification.senderId;
  const chatPeerId = actorId ?? notification.conversationId;

  switch (notification.type) {
    case 'message_received':
    case 'incoming_call':
      if (chatPeerId) {
        return {
          kind: 'chat',
          userId: chatPeerId,
          name:
            options.actorName ||
            (notification.type === 'incoming_call' ? 'Входящий звонок' : 'Чат'),
          incomingCall: notification.type === 'incoming_call',
          callId: notification.callId,
        };
      }
      return { kind: 'chatList' };
    case 'friend_request':
      return { kind: 'tab', tab: 'Friends' };
    case 'friend_accepted':
      if (actorId) {
        return {
          kind: 'userProfile',
          userId: actorId,
          name: options.actorName || 'Профиль',
        };
      }
      return { kind: 'tab', tab: 'Friends' };
    case 'post_liked':
    case 'comment_created':
      return { kind: 'tab', tab: 'Home' };
    default:
      return { kind: 'tab', tab: 'Home' };
  }
}

function navigateRootNotificationRoute(route: NotificationRoute) {
  switch (route.kind) {
    case 'chat':
      navigationRef.navigate('MainTabs', {
        screen: 'Chats',
        params: {
          initial: false,
          screen: 'Chat',
          params: {
            userId: route.userId,
            name: route.name,
            incomingCall: route.incomingCall,
            callId: route.callId,
          },
        },
      });
      return;
    case 'chatList':
      navigationRef.navigate('MainTabs', {
        screen: 'Chats',
        params: {
          screen: 'ChatList',
        },
      });
      return;
    case 'tab':
      navigationRef.navigate('MainTabs', {
        screen: route.tab,
      });
      return;
    case 'userProfile':
      navigationRef.navigate('UserProfile', {
        userId: route.userId,
        name: route.name,
      });
  }
}

function navigateNow(notification: MobileNotificationData) {
  if (notification.type === 'incoming_call') {
    rememberPendingIncomingCall(notification).catch(() => undefined);
  }
  navigateRootNotificationRoute(notificationRouteFromPayload(notification));
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

export function clearPendingNotificationNavigation() {
  pendingNotification = null;
}
