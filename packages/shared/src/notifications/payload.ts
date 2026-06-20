export const NOTIFICATION_TYPES = {
  MESSAGE_RECEIVED: 'message_received',
  FRIEND_REQUEST: 'friend_request',
  FRIEND_ACCEPTED: 'friend_accepted',
  POST_LIKED: 'post_liked',
  COMMENT_CREATED: 'comment_created',
  INCOMING_CALL: 'incoming_call',
  NOTIFICATION_SYNC: 'notification_sync',
  SYSTEM: 'system',
} as const;

export const NOTIFICATION_SYNC_ACTIONS = {
  MESSAGE_READ: 'message_read',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type PushNotificationData = {
  type: NotificationType | string;
  actorId?: number;
  senderId?: number;
  entityId?: number;
  messageId?: number;
  conversationId?: number;
  callId?: string;
  syncAction?: string;
  url?: string;
};

export type MobileNotificationType = NotificationType;
export type MobileNotificationData = PushNotificationData;

export function messageNotificationTag(conversationId: number | string) {
  return `message:${conversationId}`;
}

function numberFromValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function normalizeNotificationData(
  data?: Record<string, unknown> | null,
): PushNotificationData {
  if (!data) {
    return {
      type: NOTIFICATION_TYPES.SYSTEM,
    };
  }

  const type =
    typeof data.type === 'string' ? data.type : NOTIFICATION_TYPES.SYSTEM;
  const url = typeof data.url === 'string' ? data.url : undefined;
  const callId =
    typeof data.call_id === 'string'
      ? data.call_id
      : typeof data.callId === 'string'
        ? data.callId
        : undefined;

  return {
    type,
    actorId: numberFromValue(data.actor_id ?? data.actorId),
    senderId: numberFromValue(data.sender_id ?? data.senderId),
    entityId: numberFromValue(data.entity_id ?? data.entityId),
    messageId: numberFromValue(data.message_id ?? data.messageId),
    conversationId: numberFromValue(data.conversation_id ?? data.conversationId),
    callId,
    syncAction:
      typeof data.sync_action === 'string'
        ? data.sync_action
        : typeof data.syncAction === 'string'
          ? data.syncAction
          : undefined,
    url,
  };
}
