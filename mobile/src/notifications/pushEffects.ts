import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MobileNotificationData } from './types';
import {
  rememberPendingIncomingCall,
  rememberTerminalIncomingCall,
} from './pendingIncomingCall';

const pendingPushEventsKey = '@social/pending-push-events:v1';
const maxPendingPushEvents = 25;

export type PushNotificationEffect =
  | {
      type: 'message_read';
      conversationId?: number;
    }
  | {
      type: 'chat_changed';
      conversationId?: number;
    }
  | {
      type: 'refresh_unread';
    }
  | {
      type: 'refresh_notifications';
    }
  | {
      type: 'incoming_call';
    }
  | {
      type: 'call_terminal';
    };

export type PendingPushEvent = {
  id: string;
  notification: MobileNotificationData;
  effects: PushNotificationEffect[];
  createdAt: number;
};

export type PushNotificationEffectHandlers = {
  markConversationRead?: (conversationId?: number) => void;
  signalChatDataChanged?: () => void;
  refreshUnreadCount?: () => Promise<void> | void;
  refreshNotifications?: () => Promise<void> | void;
};

function isMessageReadSync(notification: MobileNotificationData) {
  return (
    (notification.type === 'notification_sync' &&
      notification.syncAction === 'message_read') ||
    notification.type === 'message_read'
  );
}

export function effectsForPushNotification(
  notification: MobileNotificationData,
): PushNotificationEffect[] {
  if (isMessageReadSync(notification)) {
    return [
      {
        type: 'message_read',
        conversationId: notification.conversationId,
      },
      {
        type: 'chat_changed',
        conversationId: notification.conversationId,
      },
      { type: 'refresh_unread' },
      { type: 'refresh_notifications' },
    ];
  }

  if (notification.type === 'message_received') {
    return [
      {
        type: 'chat_changed',
        conversationId: notification.conversationId ?? notification.actorId,
      },
      { type: 'refresh_unread' },
      { type: 'refresh_notifications' },
    ];
  }

  if (notification.type === 'incoming_call') {
    return [{ type: 'incoming_call' }, { type: 'refresh_notifications' }];
  }

  if (
    notification.type === 'call_ended' ||
    notification.type === 'call_rejected' ||
    notification.type === 'call_missed'
  ) {
    return [{ type: 'call_terminal' }, { type: 'refresh_notifications' }];
  }

  return [{ type: 'refresh_unread' }, { type: 'refresh_notifications' }];
}

export function applyPushNotificationEffects(
  notification: MobileNotificationData,
  handlers: PushNotificationEffectHandlers,
) {
  const effects = effectsForPushNotification(notification);
  effects.forEach(effect => {
    switch (effect.type) {
      case 'message_read':
        handlers.markConversationRead?.(effect.conversationId);
        return;
      case 'chat_changed':
        handlers.signalChatDataChanged?.();
        return;
      case 'refresh_unread':
        Promise.resolve(handlers.refreshUnreadCount?.()).catch(() => undefined);
        return;
      case 'refresh_notifications':
        Promise.resolve(handlers.refreshNotifications?.()).catch(
          () => undefined,
        );
        return;
      case 'incoming_call':
        rememberPendingIncomingCall(notification).catch(() => undefined);
        return;
      case 'call_terminal':
        rememberTerminalIncomingCall(notification.callId).catch(
          () => undefined,
        );
        return;
    }
  });
}

async function readPendingEvents() {
  const raw = await AsyncStorage.getItem(pendingPushEventsKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingPushEvent[]) : [];
  } catch {
    return [];
  }
}

export async function enqueuePendingPushEvent(
  notification: MobileNotificationData,
  now = Date.now(),
) {
  const effects = effectsForPushNotification(notification);
  if (effects.length === 0) {
    return null;
  }

  const nextEvent: PendingPushEvent = {
    id: `${now}:${Math.random().toString(36).slice(2)}`,
    notification,
    effects,
    createdAt: now,
  };
  const existing = await readPendingEvents();
  const nextEvents = [...existing, nextEvent].slice(-maxPendingPushEvents);
  await AsyncStorage.setItem(pendingPushEventsKey, JSON.stringify(nextEvents));

  if (notification.type === 'incoming_call') {
    await rememberPendingIncomingCall(notification, now);
  } else if (
    notification.type === 'call_ended' ||
    notification.type === 'call_rejected' ||
    notification.type === 'call_missed'
  ) {
    await rememberTerminalIncomingCall(notification.callId, now);
  }

  return nextEvent;
}

export async function drainPendingPushEvents() {
  const events = await readPendingEvents();
  if (events.length > 0) {
    await AsyncStorage.removeItem(pendingPushEventsKey);
  }
  return events;
}

export async function clearPendingPushEvents() {
  await AsyncStorage.removeItem(pendingPushEventsKey);
}
