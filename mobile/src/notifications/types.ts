import {
  normalizeNotificationData as normalizeSharedNotificationData,
  type MobileNotificationData as SharedMobileNotificationData,
  type MobileNotificationType,
} from '@social/shared';

export type { MobileNotificationType };

export type MobileNotificationData = SharedMobileNotificationData & {
  title?: string;
  body?: string;
  tag?: string;
  notificationId?: number;
  timestamp?: number;
  callerName?: string;
};

function stringFromValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function normalizeNotificationData(
  data?: Record<string, unknown> | null,
): MobileNotificationData {
  const notification = normalizeSharedNotificationData(data);

  return {
    ...notification,
    title: stringFromValue(data?.title),
    body: stringFromValue(data?.body),
    tag: stringFromValue(data?.tag),
    notificationId: numberFromValue(data?.notification_id ?? data?.notificationId),
    timestamp: numberFromValue(data?.ts ?? data?.timestamp),
    callerName: stringFromValue(data?.caller_name ?? data?.callerName),
  };
}
