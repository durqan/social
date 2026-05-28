import { toast } from 'react-hot-toast';
import type { SocialNotification } from "@/shared/types/domain.js";

const notificationsBaseURL = (import.meta.env.VITE_NOTIFICATIONS_URL || '/notifications-api').replace(/\/$/, '');

export type PushSubscriptionPayload = {
    user_id: number;
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
};

export const showMessageNotification = (name: string, content: string) => {
    toast(`${name}: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`, {
        duration: 5000,
        position: 'top-right',
    });
};

const requestNotifications = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${notificationsBaseURL}${path}`, init);
    if (!response.ok) {
        throw new Error(`Notifications request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
};

export const notificationService = {
    getNotifications(userId: number): Promise<SocialNotification[]> {
        return requestNotifications<SocialNotification[]>(`/notifications/${userId}`);
    },

    async markAsRead(notificationId: number): Promise<void> {
        await requestNotifications<{ status: string }>(`/notifications/${notificationId}/read`, {
            method: 'PATCH',
        });
    },

    streamNotifications(userId: number): EventSource {
        return new EventSource(`${notificationsBaseURL}/notifications/${userId}/stream`);
    },

    async subscribePush(subscription: PushSubscriptionPayload): Promise<void> {
        await requestNotifications<{ status: string }>('/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(subscription),
        });
    },
};
