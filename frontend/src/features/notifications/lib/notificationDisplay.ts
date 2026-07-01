import type { SocialNotification } from "@/shared/types/domain.js";

export const fallbackActorName = "Пользователь";

const notificationText: Record<string, (actorName: string) => string> = {
  post_liked: (actorName) => `${actorName} лайкнул(а) ваш пост`,
  comment_created: (actorName) => `${actorName} прокомментировал(а) ваш пост`,
  friend_request: (actorName) => `${actorName} отправил(а) заявку в друзья`,
  friend_accepted: (actorName) => `${actorName} принял(а) вашу заявку`,
  message_received: (actorName) => `${actorName} написал(а) вам`,
  incoming_call: (actorName) => `${actorName} звонил(а) вам`,
};

export function getNotificationTitle(
  notification: SocialNotification,
  actorName?: string,
) {
  const buildTitle = notificationText[notification.type];
  if (!buildTitle) {
    return "Новое уведомление";
  }

  return buildTitle(actorName || fallbackActorName);
}

export function countUnseenNotificationBadge(
  notifications: SocialNotification[],
) {
  return notifications.filter((notification) => !notification.is_seen).length;
}

export function notificationSeenIdsForVisibleNotifications(
  visibleNotifications: SocialNotification[],
) {
  return visibleNotifications
    .filter((notification) => !notification.is_seen)
    .map((notification) => notification.id);
}
