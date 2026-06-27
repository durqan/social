import { createNavigationContainerRef } from '@react-navigation/native';

import type { MainStackParamList } from '../navigation/types';
import type { MobileNotificationData } from './types';
import { rememberPendingIncomingCall } from './pendingIncomingCall';

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

function routeFromURL(url?: string): NotificationRoute | null {
  if (!url) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, 'https://social.local');
  } catch {
    return null;
  }

  const chatMatch = parsed.pathname.match(/^\/users\/\d+\/chat\/(\d+)$/);
  if (chatMatch) {
    const userId = Number(chatMatch[1]);
    return Number.isFinite(userId)
      ? {
          kind: 'chat',
          userId,
          name: 'Чат',
        }
      : null;
  }

  if (/^\/users\/\d+\/friends$/.test(parsed.pathname)) {
    return { kind: 'tab', tab: 'Friends' };
  }

  if (/^\/users\/\d+\/wall$/.test(parsed.pathname)) {
    return { kind: 'tab', tab: 'Home' };
  }

  const userMatch = parsed.pathname.match(/^\/users\/(\d+)$/);
  if (userMatch) {
    const userId = Number(userMatch[1]);
    return Number.isFinite(userId)
      ? {
          kind: 'userProfile',
          userId,
          name: 'Профиль',
        }
      : null;
  }

  return null;
}

export type NotificationRoute =
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
      tab: 'Home' | 'Friends' | 'Notifications' | 'Profile' | 'Settings';
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
  const actorId =
    notification.actorId ??
    notification.senderId ??
    actorFromChatURL(notification.url);
  const conversationId = notification.conversationId ?? actorId;

  switch (notification.type) {
    case 'message_received':
    case 'incoming_call':
      if (conversationId) {
        return {
          kind: 'chat',
          userId: conversationId,
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
      return routeFromURL(notification.url) ?? { kind: 'tab', tab: 'Home' };
    default:
      return (
        routeFromURL(notification.url) ?? { kind: 'tab', tab: 'Notifications' }
      );
  }
}

export function navigateRootNotificationRoute(route: NotificationRoute) {
  switch (route.kind) {
    case 'chat':
      navigationRef.navigate('MainTabs', {
        screen: 'Chats',
        params: {
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

export function navigateTabNotificationRoute(
  navigation: { navigate: (name: string, params?: unknown) => void },
  route: NotificationRoute,
) {
  switch (route.kind) {
    case 'chat':
      navigation.navigate('Chats', {
        screen: 'Chat',
        params: {
          userId: route.userId,
          name: route.name,
          incomingCall: route.incomingCall,
          callId: route.callId,
        },
      });
      return;
    case 'chatList':
      navigation.navigate('Chats', {
        screen: 'ChatList',
      });
      return;
    case 'tab':
      navigation.navigate(route.tab);
      return;
    case 'userProfile':
      navigation.navigate('UserProfile', {
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
