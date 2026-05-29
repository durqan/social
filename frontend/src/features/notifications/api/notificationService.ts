import { toast } from 'react-hot-toast';
import { request } from "@/shared/api/axios.js";
import type { SocialNotification } from "@/shared/types/domain.js";

const notificationsBaseURL = (import.meta.env.VITE_NOTIFICATIONS_URL || '/notifications-api').replace(/\/$/, '');

export type PushSubscriptionPayload = {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
};

export type MarkNotificationsReadPayload = {
    types: string[];
    actor_id?: number;
    entity_id?: number;
};

export const showMessageNotification = (name: string, content: string) => {
    toast(`${name}: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`, {
        duration: 5000,
        position: 'top-right',
    });
};

const requestNotifications = async <T>(path: string, init?: RequestInit, retry = true): Promise<T> => {
    const response = await fetch(`${notificationsBaseURL}${path}`, {
        ...init,
        credentials: 'include',
    });
    if (response.status === 401 && retry) {
        await request.post('/auth/refresh');
        return requestNotifications<T>(path, init, false);
    }
    if (!response.ok) {
        throw new Error(`Notifications request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
};

export const notificationService = {
    getNotifications(): Promise<SocialNotification[]> {
        return requestNotifications<SocialNotification[]>('/notifications');
    },

    async markAsRead(notificationId: number): Promise<void> {
        await requestNotifications<{ status: string }>(`/notifications/${notificationId}/read`, {
            method: 'PATCH',
        });
    },

    async markMatchingAsRead(payload: MarkNotificationsReadPayload): Promise<void> {
        await requestNotifications<{ status: string }>('/notifications/read-matching', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    },

    streamNotifications(): EventSource {
        return new EventSource(`${notificationsBaseURL}/notifications/stream`, {
            withCredentials: true,
        });
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
