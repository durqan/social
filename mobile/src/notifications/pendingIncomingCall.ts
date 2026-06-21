import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MobileNotificationData } from './types';

export const INCOMING_CALL_PUSH_TTL_MS = 60_000;

const pendingIncomingCallKey = '@social/pending-incoming-call-push:v1';

export type PendingIncomingCallPush = {
  callId: string;
  conversationId?: number;
  callerId?: number;
  callerName?: string;
  receivedAt: number;
  expiresAt: number;
};

type IncomingCallListener = (call: PendingIncomingCallPush) => void;

const listeners = new Set<IncomingCallListener>();

function timestampFromURL(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url, 'https://social.local');
    const ts = Number(parsed.searchParams.get('ts'));
    return Number.isFinite(ts) ? ts : undefined;
  } catch {
    return undefined;
  }
}

function isFresh(timestamp: number, now: number) {
  return now - timestamp <= INCOMING_CALL_PUSH_TTL_MS;
}

export function incomingCallFromNotification(
  notification: MobileNotificationData,
  now = Date.now(),
): PendingIncomingCallPush | null {
  if (notification.type !== 'incoming_call' || !notification.callId) {
    return null;
  }

  const payloadTimestamp =
    notification.timestamp ?? timestampFromURL(notification.url);
  if (payloadTimestamp && !isFresh(payloadTimestamp, now)) {
    return null;
  }

  const receivedAt = payloadTimestamp ?? now;
  return {
    callId: notification.callId,
    conversationId: notification.conversationId,
    callerId: notification.actorId ?? notification.senderId ?? notification.conversationId,
    callerName: notification.callerName ?? notification.title,
    receivedAt,
    expiresAt: receivedAt + INCOMING_CALL_PUSH_TTL_MS,
  };
}

function isPendingCallFresh(call: PendingIncomingCallPush, now = Date.now()) {
  return call.expiresAt >= now;
}

export async function rememberPendingIncomingCall(
  notification: MobileNotificationData,
  now = Date.now(),
) {
  const call = incomingCallFromNotification(notification, now);
  if (!call) {
    return null;
  }

  await AsyncStorage.setItem(pendingIncomingCallKey, JSON.stringify(call));
  listeners.forEach(listener => listener(call));
  return call;
}

export async function consumePendingIncomingCall(now = Date.now()) {
  const raw = await AsyncStorage.getItem(pendingIncomingCallKey);
  if (!raw) {
    return null;
  }

  await AsyncStorage.removeItem(pendingIncomingCallKey);

  try {
    const call = JSON.parse(raw) as PendingIncomingCallPush;
    return isPendingCallFresh(call, now) ? call : null;
  } catch {
    return null;
  }
}

export function subscribePendingIncomingCall(listener: IncomingCallListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
