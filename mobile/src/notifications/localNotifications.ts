import notifee, {
  AndroidCategory,
  AndroidFlags,
  AndroidImportance,
  AndroidLaunchActivityFlag,
  AndroidVisibility,
  EventType,
} from '@notifee/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getActivePushConversation } from './activeConversation';
import { enqueuePendingPushEvent } from './pushEffects';
import {
  INCOMING_CALL_PUSH_TTL_MS,
  rememberTerminalIncomingCall,
} from './pendingIncomingCall';
import {
  normalizeNotificationData,
  type MobileNotificationData,
} from './types';

export const MOBILE_NOTIFICATION_CHANNELS = {
  GENERAL: 'general',
  MESSAGES: 'messages',
  INCOMING_CALLS: 'incoming_calls',
} as const;

const pendingOpenedLocalNotificationKey =
  '@social/pending-opened-local-notifications:v1';

const incomingCallVibrationPattern = [300, 500, 300, 500, 300, 900];
const incomingCallLaunchActivityFlags = [
  AndroidLaunchActivityFlag.NEW_TASK,
  AndroidLaunchActivityFlag.SINGLE_TOP,
  AndroidLaunchActivityFlag.CLEAR_TOP,
];

type LocalNotificationOpenHandler = (
  notification: MobileNotificationData,
) => void;

function notificationConversationId(notification: MobileNotificationData) {
  return (
    notification.conversationId ?? notification.actorId ?? notification.senderId
  );
}

export function shouldDisplayForegroundNotification(
  notification: MobileNotificationData,
  activeConversationId = getActivePushConversation(),
) {
  if (
    notification.type === 'notification_sync' ||
    notification.type === 'message_read'
  ) {
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
  if (notification.type === 'incoming_call') {
    if (notification.callerName) {
      return `${notification.callerName} звонит`;
    }
    if (notification.body && notification.body !== 'Вам звонит пользователь') {
      return notification.body;
    }
  }

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
  if (notification.type === 'incoming_call') {
    return notification.callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
  }

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
    vibrationPattern: incomingCallVibrationPattern,
    sound: 'default',
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
      importance: incomingCall
        ? AndroidImportance.HIGH
        : AndroidImportance.DEFAULT,
      visibility: incomingCall ? AndroidVisibility.PUBLIC : undefined,
      sound: incomingCall ? 'default' : undefined,
      loopSound: incomingCall,
      lightUpScreen: incomingCall,
      lights: incomingCall ? ['#2563eb', 500, 800] : undefined,
      vibrationPattern: incomingCall ? incomingCallVibrationPattern : undefined,
      flags: incomingCall ? [AndroidFlags.FLAG_INSISTENT] : undefined,
      ongoing: incomingCall,
      autoCancel: !incomingCall,
      pressAction: {
        id: 'default',
        launchActivity: 'default',
        launchActivityFlags: incomingCall
          ? incomingCallLaunchActivityFlags
          : undefined,
      },
      fullScreenAction: incomingCall
        ? {
            id: 'default',
            launchActivity: 'default',
            launchActivityFlags: incomingCallLaunchActivityFlags,
          }
        : undefined,
      actions: incomingCall
        ? [
            {
              title: 'Ответить',
              pressAction: { id: 'answer', launchActivity: 'default' },
            },
            {
              title: 'Отклонить',
              pressAction: { id: 'reject' },
            },
          ]
        : undefined,
      timestamp: notification.timestamp,
      showTimestamp: Boolean(notification.timestamp),
      timeoutAfter: incomingCall ? INCOMING_CALL_PUSH_TTL_MS : undefined,
    },
  });

  return true;
}

export function cancelIncomingCallNotification(callId?: string | null) {
  if (!callId) {
    return Promise.resolve();
  }
  return notifee.cancelNotification(`call-${callId}`);
}

async function enqueuePendingOpenedLocalNotification(
  notification: MobileNotificationData,
) {
  const raw = await AsyncStorage.getItem(pendingOpenedLocalNotificationKey);
  let existing: MobileNotificationData[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      existing = Array.isArray(parsed)
        ? (parsed as MobileNotificationData[])
        : [];
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

export async function clearPendingOpenedLocalNotifications() {
  await AsyncStorage.removeItem(pendingOpenedLocalNotificationKey);
}

function notificationFromNotifeeData(data: unknown) {
  return normalizeNotificationData(
    data && typeof data === 'object'
      ? (data as Record<string, unknown>)
      : undefined,
  );
}

async function rejectIncomingCallFromNotification(
  notification: MobileNotificationData,
  localNotificationId?: string,
) {
  if (localNotificationId) {
    await notifee
      .cancelNotification(localNotificationId)
      .catch(() => undefined);
  }
  if (!notification.callId) {
    return;
  }
  await rememberTerminalIncomingCall(notification.callId).catch(
    () => undefined,
  );
  const { callsApi } = await import('../api/calls');
  await callsApi.rejectCall(notification.callId).catch(() => undefined);
}

async function acceptIncomingCallFromNotification(
  notification: MobileNotificationData,
  onOpen: LocalNotificationOpenHandler,
) {
  if (!notification.callId) {
    onOpen(notification);
    return;
  }

  try {
    const { callsApi } = await import('../api/calls');
    const call = await callsApi.acceptCallIntent(notification.callId);
    if (!call || call.status !== 'ringing') {
      await rememberTerminalIncomingCall(notification.callId).catch(
        () => undefined,
      );
      await cancelIncomingCallNotification(notification.callId).catch(
        () => undefined,
      );
      return;
    }
  } catch {
    await rememberTerminalIncomingCall(notification.callId).catch(
      () => undefined,
    );
    await cancelIncomingCallNotification(notification.callId).catch(
      () => undefined,
    );
    return;
  }

  await cancelIncomingCallNotification(notification.callId).catch(
    () => undefined,
  );
  onOpen(notification);
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

    const notification = notificationFromNotifeeData(
      event.detail.notification?.data,
    );
    if (event.detail.pressAction?.id === 'reject') {
      rejectIncomingCallFromNotification(
        notification,
        event.detail.notification?.id,
      ).catch(() => undefined);
      return;
    }
    if (event.detail.pressAction?.id === 'answer') {
      acceptIncomingCallFromNotification(notification, onOpen).catch(
        () => undefined,
      );
      return;
    }

    onOpen(notification);
  });

  notifee
    .getInitialNotification()
    .then(initialNotification => {
      if (initialNotification?.notification.data) {
        onOpen(
          notificationFromNotifeeData(initialNotification.notification.data),
        );
      }
    })
    .catch(() => undefined);

  drainPendingOpenedLocalNotifications()
    .then(notifications => {
      notifications.forEach(onOpen);
    })
    .catch(() => undefined);

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

    if (event.detail.pressAction?.id === 'reject') {
      await rejectIncomingCallFromNotification(
        notification,
        event.detail.notification?.id,
      );
      return;
    }

    if (event.detail.pressAction?.id === 'answer' && notification.callId) {
      try {
        const { callsApi } = await import('../api/calls');
        const call = await callsApi.acceptCallIntent(notification.callId);
        if (!call || call.status !== 'ringing') {
          await rememberTerminalIncomingCall(notification.callId).catch(
            () => undefined,
          );
          await cancelIncomingCallNotification(notification.callId);
          return;
        }
      } catch {
        await rememberTerminalIncomingCall(notification.callId).catch(
          () => undefined,
        );
        await cancelIncomingCallNotification(notification.callId);
        return;
      }
      await cancelIncomingCallNotification(notification.callId).catch(
        () => undefined,
      );
      await enqueuePendingPushEvent(notification);
      await enqueuePendingOpenedLocalNotification(notification);
      return;
    }

    await enqueuePendingPushEvent(notification);
    await enqueuePendingOpenedLocalNotification(notification);
  });
}

export function openLocalNotificationSettings() {
  return notifee.openNotificationSettings();
}
