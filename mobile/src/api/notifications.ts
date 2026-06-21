import { notificationsURL } from '../config/env';
import { getCookieHeader, refreshSession } from './http';
import type { SocialNotification } from './types';

export type MobilePushTokenPayload = {
  provider: 'fcm';
  platform: 'android';
  token: string;
};

export type MarkNotificationsReadPayload = {
  types: string[];
  actor_id?: number;
  entity_id?: number;
  conversation_id?: number;
};

type NotificationRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

async function requestNotifications<T>(
  path: string,
  options: NotificationRequestOptions = {},
  retry = true,
): Promise<T> {
  const cookieHeader = await getCookieHeader();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cookieHeader
      ? {
          Cookie: cookieHeader,
        }
      : {}),
  };
  let body: string | undefined;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(notificationsURL(path), {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    body,
  });

  if (response.status === 401 && retry) {
    await refreshSession();
    return requestNotifications<T>(path, options, false);
  }

  if (!response.ok) {
    throw new Error('Не удалось обновить настройки уведомлений');
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const notificationsApi = {
  getNotifications() {
    return requestNotifications<SocialNotification[]>('/notifications');
  },

  async markAsRead(notificationId: number) {
    await requestNotifications<{ status: string }>(
      `/notifications/${notificationId}/read`,
      {
        method: 'PATCH',
      },
    );
  },

  async markAsSeen(notificationIds: number[]) {
    await requestNotifications<{ status: string }>('/notifications/seen', {
      method: 'PATCH',
      body: {
        ids: notificationIds,
      },
    });
  },

  async markMatchingAsRead(payload: MarkNotificationsReadPayload) {
    await requestNotifications<{ status: string }>('/notifications/read-matching', {
      method: 'PATCH',
      body: payload,
    });
  },

  registerMobilePushToken(payload: MobilePushTokenPayload) {
    return requestNotifications<{ status: string }>('/push/mobile-token', {
      method: 'POST',
      body: payload,
    });
  },

  revokeMobilePushToken(payload: MobilePushTokenPayload) {
    return requestNotifications<{ status: string }>('/push/mobile-token', {
      method: 'DELETE',
      body: payload,
    });
  },
};
