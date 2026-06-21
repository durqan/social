import { describe, expect, it } from "vitest";

import {
  countUnseenNotificationBadge,
  getNotificationTitle,
  notificationSeenIdsForVisibleNotifications,
} from "./NotificationBell";
import type { SocialNotification } from "@/shared/types/domain.js";

function notification(
  id: number,
  overrides: Partial<SocialNotification> = {},
): SocialNotification {
  return {
    id,
    recipient_id: 1,
    actor_id: 2,
    type: "friend_request",
    entity_id: id,
    is_read: false,
    is_seen: false,
    created_at: new Date(2026, 0, id).toISOString(),
    ...overrides,
  };
}

describe("NotificationBell notification display", () => {
  it("does not group 251 message notifications into an aggregate title", () => {
    const notifications = Array.from({ length: 251 }, (_, index) =>
      notification(index + 1, {
        actor_id: 10,
        type: "message_received",
        conversation_id: 10,
      }),
    );

    expect(countUnseenNotificationBadge(notifications)).toBe(251);
    expect(getNotificationTitle(notifications[0], "Анна")).toBe(
      "Анна написал(а) вам",
    );
    expect(getNotificationTitle(notifications[0], "Анна")).not.toContain(
      "новых сообщений",
    );
  });

  it("uses the regular message notification title", () => {
    expect(
      getNotificationTitle(
        notification(1, {
          type: "message_received",
          conversation_id: 10,
        }),
        "Анна",
      ),
    ).toBe("Анна написал(а) вам");
  });

  it("selects visible unseen notification ids for mark-as-seen", () => {
    const visibleNotifications = [
      notification(1, { is_seen: false }),
      notification(2, { is_seen: true }),
      notification(3, { is_seen: false }),
    ];

    expect(
      notificationSeenIdsForVisibleNotifications(visibleNotifications),
    ).toEqual([1, 3]);
  });

  it("badge disappears after visible notifications are marked seen", () => {
    const seenNotifications = [
      notification(1, { is_seen: true }),
      notification(2, { is_seen: true }),
    ];

    expect(countUnseenNotificationBadge(seenNotifications)).toBe(0);
  });
});
