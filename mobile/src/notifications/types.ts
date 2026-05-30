export type MobileNotificationType =
  | 'message_received'
  | 'friend_request'
  | 'friend_accepted'
  | 'system';

export type MobileNotificationData = {
  type: MobileNotificationType | string;
  actorId?: number;
  entityId?: number;
  url?: string;
};

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
): MobileNotificationData {
  if (!data) {
    return {
      type: 'system',
    };
  }

  const type = typeof data.type === 'string' ? data.type : 'system';
  const url = typeof data.url === 'string' ? data.url : undefined;

  return {
    type,
    actorId: numberFromValue(data.actor_id ?? data.actorId),
    entityId: numberFromValue(data.entity_id ?? data.entityId),
    url,
  };
}
