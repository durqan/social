import { describe, expect, it } from 'vitest';

import {
    groupNotificationsForDisplay,
    notificationSeenIdsForVisibleItems,
} from './NotificationBell';
import type { SocialNotification } from '@/shared/types/domain.js';

function notification(
    id: number,
    overrides: Partial<SocialNotification> = {},
): SocialNotification {
    return {
        id,
        recipient_id: 1,
        actor_id: 2,
        type: 'friend_request',
        entity_id: id,
        is_read: false,
        is_seen: false,
        created_at: new Date(2026, 0, id).toISOString(),
        ...overrides,
    };
}

describe('NotificationBell notification grouping', () => {
    it('groups message notifications by conversation for display', () => {
        const items = groupNotificationsForDisplay([
            notification(3, {
                actor_id: 10,
                type: 'message_received',
                conversation_id: 10,
                created_at: '2026-01-03T00:00:00.000Z',
            }),
            notification(2, {
                actor_id: 10,
                type: 'message_received',
                conversation_id: 10,
                created_at: '2026-01-02T00:00:00.000Z',
            }),
            notification(1, {
                actor_id: 11,
                type: 'message_received',
                conversation_id: 11,
                created_at: '2026-01-01T00:00:00.000Z',
            }),
        ]);

        expect(items).toHaveLength(2);
        expect(items[0]?.count).toBe(2);
        expect(items[0]?.seenIds).toEqual([3, 2]);
        expect(items[0]?.notification.id).toBe(3);
    });

    it('marks hidden duplicate message notifications seen with the visible conversation row', () => {
        const notifications = [
            notification(3, {
                actor_id: 10,
                type: 'message_received',
                conversation_id: 10,
            }),
            notification(2, {
                actor_id: 10,
                type: 'message_received',
                conversation_id: 10,
            }),
            notification(1, {
                actor_id: 11,
                type: 'message_received',
                conversation_id: 11,
            }),
        ];
        const visibleItems = groupNotificationsForDisplay(notifications).slice(0, 1);

        expect(notificationSeenIdsForVisibleItems(notifications, visibleItems).sort()).toEqual([2, 3]);
    });
});
