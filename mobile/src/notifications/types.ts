export type MobileNotificationData = {
  type: string;
  actorId?: number;
  senderId?: number;
  entityId?: number;
  messageId?: number;
  conversationId?: number;
  callId?: string;
  callType?: 'audio' | 'video' | string;
  syncAction?: string;
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
  return {
    type: stringFromValue(data?.type) ?? 'system',
    actorId: numberFromValue(data?.actor_id),
    senderId: numberFromValue(data?.sender_id),
    entityId: numberFromValue(data?.entity_id),
    messageId: numberFromValue(data?.message_id),
    conversationId: numberFromValue(data?.conversation_id),
    callId: stringFromValue(data?.call_id),
    callType: stringFromValue(data?.call_type),
    syncAction: stringFromValue(data?.sync_action),
    title: stringFromValue(data?.title),
    body: stringFromValue(data?.body),
    tag: stringFromValue(data?.tag),
    notificationId: numberFromValue(data?.notification_id),
    timestamp: numberFromValue(data?.ts),
    callerName: stringFromValue(data?.caller_name),
  };
}
