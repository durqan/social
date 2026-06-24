import notifee, {
  AndroidCategory,
  AndroidImportance,
  EventType,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getActivePushConversation } from './activeConversation';
import { enqueuePendingPushEvent } from './pushEffects';
import { normalizeNotificationData, type MobileNotificationData } from './types';

export const MOBILE_NOTIFICATION_CHANNELS = {
  GENERAL: 'general',
  MESSAGES: 'messages',
  INCOMING_CALLS: 'incoming_calls',
} as const;

const pendingOpenedLocalNotificationKey =
  '@social/pending-opened-local-notifications:v1';

type LocalNotificationOpenHandler = (
  notification: MobileNotificationData,
) => void;

function notificationConversationId(notification: MobileNotificationData) {
  return notification.conversationId ?? notification.actorId ?? notification.senderId;
}

export function shouldDisplayForegroundNotification(
  notification: MobileNotificationData,
  activeConversationId = getActivePushConversation(),
) {
  if (notification.type === 'notification_sync' || notification.type === 'message_read') {
    return false;
  }

  if (
    notification.type === 'message_received' &&
    activeConversationId &&
    notificationConversationId(notification) === activeConversationId
  ) {
    return false;
  }

  return (
    notification.type === 'message_received' ||
    notification.type === 'incoming_call' ||
    notification.type === 'friend_request' ||
    notification.type === 'friend_accepted' ||
    notification.type === 'post_liked' ||
    notification.type === 'comment_created'
  );
}

function titleForNotification(notification: MobileNotificationData) {
  if (notification.title) {
    return notification.title;
  }

  switch (notification.type) {
    case 'message_received':
      return 'Новое сообщение';
    case 'incoming_call':
      return 'Входящий звонок';
    case 'friend_request':
      return 'Новая заявка в друзья';
    case 'friend_accepted':
      return 'Заявка принята';
    case 'post_liked':
      return 'Новый лайк';
    case 'comment_created':
      return 'Новый комментарий';
    default:
      return 'Новое уведомление';
  }
}

function bodyForNotification(notification: MobileNotificationData) {
  if (notification.body) {
    return notification.body;
  }

  switch (notification.type) {
    case 'message_received':
      return 'Откройте чат, чтобы прочитать сообщение';
    case 'incoming_call':
      return 'Нажмите, чтобы открыть звонок';
    case 'friend_request':
      return 'Откройте заявки в друзья';
    case 'friend_accepted':
      return 'Откройте профиль пользователя';
    case 'post_liked':
    case 'comment_created':
      return 'Откройте приложение, чтобы посмотреть';
    default:
      return 'Откройте приложение';
  }
}

function notificationId(notification: MobileNotificationData) {
  if (notification.tag) {
    return notification.tag;
  }
  if (notification.notificationId) {
    return `notification-${notification.notificationId}`;
  }
  if (notification.type === 'message_received') {
    return `message-${notificationConversationId(notification) ?? Date.now()}`;
  }
  if (notification.type === 'incoming_call' && notification.callId) {
    return `call-${notification.callId}`;
  }
  return undefined;
}

function dataForNotification(notification: MobileNotificationData) {
  const data: Record<string, string> = {
    type: notification.type,
  };

  if (notification.actorId) data.actor_id = String(notification.actorId);
  if (notification.senderId) data.sender_id = String(notification.senderId);
  if (notification.entityId) data.entity_id = String(notification.entityId);
  if (notification.messageId) data.message_id = String(notification.messageId);
  if (notification.conversationId) {
    data.conversation_id = String(notification.conversationId);
  }
  if (notification.callId) data.call_id = notification.callId;
  if (notification.callType) data.call_type = notification.callType;
  if (notification.syncAction) data.sync_action = notification.syncAction;
  if (notification.url) data.url = notification.url;
  if (notification.title) data.title = notification.title;
  if (notification.body) data.body = notification.body;
  if (notification.tag) data.tag = notification.tag;
  if (notification.notificationId) {
    data.notification_id = String(notification.notificationId);
  }
  if (notification.timestamp) data.ts = String(notification.timestamp);
  if (notification.callerName) data.caller_name = notification.callerName;

  return data;
}

async function createLocalNotificationChannels() {
  await notifee.createChannel({
    id: MOBILE_NOTIFICATION_CHANNELS.GENERAL,
    name: 'General',
    importance: AndroidImportance.DEFAULT,
  });
  await notifee.createChannel({
    id: MOBILE_NOTIFICATION_CHANNELS.MESSAGES,
    name: 'Messages',
    importance: AndroidImportance.DEFAULT,
    vibration: true,
  });
  await notifee.createChannel({
    id: MOBILE_NOTIFICATION_CHANNELS.INCOMING_CALLS,
    name: 'Incoming calls',
    importance: AndroidImportance.HIGH,
    vibration: true,
  });
}

export async function displayForegroundNotification(
  notification: MobileNotificationData,
) {
  if (
    Platform.OS !== 'android' ||
    !shouldDisplayForegroundNotification(notification)
  ) {
    return false;
  }

  await createLocalNotificationChannels();

  const incomingCall = notification.type === 'incoming_call';
  await notifee.displayNotification({
    id: notificationId(notification),
    title: titleForNotification(notification),
    body: bodyForNotification(notification),
    data: dataForNotification(notification),
    android: {
      channelId: incomingCall
        ? MOBILE_NOTIFICATION_CHANNELS.INCOMING_CALLS
        : notification.type === 'message_received'
          ? MOBILE_NOTIFICATION_CHANNELS.MESSAGES
          : MOBILE_NOTIFICATION_CHANNELS.GENERAL,
      smallIcon: 'ic_stat_social_notification',
      color: '#2563eb',
      category: incomingCall
        ? AndroidCategory.CALL
        : notification.type === 'message_received'
          ? AndroidCategory.MESSAGE
          : AndroidCategory.SOCIAL,
      importance: incomingCall ? AndroidImportance.HIGH : AndroidImportance.DEFAULT,
      pressAction: {
        id: 'default',
      },
      timestamp: notification.timestamp,
      showTimestamp: Boolean(notification.timestamp),
    },
  });

  return true;
}

async function enqueuePendingOpenedLocalNotification(
  notification: MobileNotificationData,
) {
  const raw = await AsyncStorage.getItem(pendingOpenedLocalNotificationKey);
  let existing: MobileNotificationData[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      existing = Array.isArray(parsed) ? parsed as MobileNotificationData[] : [];
    } catch {
      existing = [];
    }
  }
  await AsyncStorage.setItem(
    pendingOpenedLocalNotificationKey,
    JSON.stringify([...existing, notification].slice(-10)),
  );
}

export async function drainPendingOpenedLocalNotifications() {
  const raw = await AsyncStorage.getItem(pendingOpenedLocalNotificationKey);
  if (!raw) {
    return [];
  }
  await AsyncStorage.removeItem(pendingOpenedLocalNotificationKey);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MobileNotificationData[]) : [];
  } catch {
    return [];
  }
}

function notificationFromNotifeeData(data: unknown) {
  return normalizeNotificationData(
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : undefined,
  );
}

export function registerLocalNotificationOpenHandlers(
  onOpen: LocalNotificationOpenHandler,
) {
  const cleanup = notifee.onForegroundEvent(event => {
    if (
      event.type !== EventType.PRESS &&
      event.type !== EventType.ACTION_PRESS
    ) {
      return;
    }

    onOpen(notificationFromNotifeeData(event.detail.notification?.data));
  });

  notifee.getInitialNotification().then(initialNotification => {
    if (initialNotification?.notification.data) {
      onOpen(notificationFromNotifeeData(initialNotification.notification.data));
    }
  }).catch(() => undefined);

  drainPendingOpenedLocalNotifications().then(notifications => {
    notifications.forEach(onOpen);
  }).catch(() => undefined);

  return cleanup;
}

export function registerLocalNotificationBackgroundHandler() {
  notifee.onBackgroundEvent(async event => {
    if (
      event.type !== EventType.PRESS &&
      event.type !== EventType.ACTION_PRESS
    ) {
      return;
    }

    const notification = notificationFromNotifeeData(
      event.detail.notification?.data,
    );
    await enqueuePendingPushEvent(notification);
    await enqueuePendingOpenedLocalNotification(notification);
  });
}

export function openLocalNotificationSettings() {
  return notifee.openNotificationSettings();
}
