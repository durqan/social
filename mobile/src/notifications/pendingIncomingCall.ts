import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MobileNotificationData } from './types';

export const INCOMING_CALL_PUSH_TTL_MS = 60_000;
const TERMINAL_CALL_TTL_MS = 5 * 60_000;

const pendingIncomingCallKey = '@social/pending-incoming-call-push:v1';
const terminalIncomingCallsKey = '@social/terminal-incoming-calls:v1';

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
    callerId:
      notification.actorId ??
      notification.senderId ??
      notification.conversationId,
    callerName: notification.callerName ?? notification.title,
    receivedAt,
    expiresAt: receivedAt + INCOMING_CALL_PUSH_TTL_MS,
  };
}

function isPendingCallFresh(call: PendingIncomingCallPush, now = Date.now()) {
  return call.expiresAt >= now;
}

type TerminalIncomingCallRecord = {
  callId: string;
  expiresAt: number;
};

async function readTerminalIncomingCalls(now = Date.now()) {
  const raw = await AsyncStorage.getItem(terminalIncomingCallsKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? (parsed as TerminalIncomingCallRecord[])
      : [];
    return records.filter(
      record =>
        typeof record.callId === 'string' &&
        record.callId.length > 0 &&
        record.expiresAt >= now,
    );
  } catch {
    return [];
  }
}

async function writeTerminalIncomingCalls(
  records: TerminalIncomingCallRecord[],
) {
  if (records.length === 0) {
    await AsyncStorage.removeItem(terminalIncomingCallsKey);
    return;
  }
  await AsyncStorage.setItem(
    terminalIncomingCallsKey,
    JSON.stringify(records.slice(-50)),
  );
}

async function isTerminalIncomingCall(
  callId?: string | null,
  now = Date.now(),
) {
  const normalizedCallId = callId?.trim();
  if (!normalizedCallId) {
    return false;
  }

  const records = await readTerminalIncomingCalls(now);
  const active = records.some(record => record.callId === normalizedCallId);
  await writeTerminalIncomingCalls(records);
  return active;
}

export async function rememberTerminalIncomingCall(
  callId?: string | null,
  now = Date.now(),
) {
  const normalizedCallId = callId?.trim();
  if (!normalizedCallId) {
    return;
  }

  const records = await readTerminalIncomingCalls(now);
  const nextRecords = records.filter(
    record => record.callId !== normalizedCallId,
  );
  nextRecords.push({
    callId: normalizedCallId,
    expiresAt: now + TERMINAL_CALL_TTL_MS,
  });
  await writeTerminalIncomingCalls(nextRecords);
  await clearPendingIncomingCall(normalizedCallId);
}

export async function rememberPendingIncomingCall(
  notification: MobileNotificationData,
  now = Date.now(),
) {
  const call = incomingCallFromNotification(notification, now);
  if (!call) {
    return null;
  }
  if (await isTerminalIncomingCall(call.callId, now)) {
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
    if (!isPendingCallFresh(call, now)) {
      return null;
    }
    if (await isTerminalIncomingCall(call.callId, now)) {
      return null;
    }
    return call;
  } catch {
    return null;
  }
}

export async function clearPendingIncomingCall(callId?: string | null) {
  const normalizedCallId = callId?.trim();
  if (!normalizedCallId) {
    await AsyncStorage.removeItem(pendingIncomingCallKey);
    return;
  }

  const raw = await AsyncStorage.getItem(pendingIncomingCallKey);
  if (!raw) {
    return;
  }

  try {
    const call = JSON.parse(raw) as PendingIncomingCallPush;
    if (call.callId === normalizedCallId) {
      await AsyncStorage.removeItem(pendingIncomingCallKey);
    }
  } catch {
    await AsyncStorage.removeItem(pendingIncomingCallKey);
  }
}

export function subscribePendingIncomingCall(listener: IncomingCallListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
