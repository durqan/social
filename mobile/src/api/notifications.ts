import { notificationsURL } from '../config/env';
import {
  apiCacheKey,
  apiRequest,
  apiRequestMeta,
  type RequestOptions,
} from './http';
import type { SocialNotification } from './types';

type MobilePushTokenPayload = {
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

function notificationRequestOptions(
  options: RequestOptions = {},
): RequestOptions {
  return {
    ...options,
    resolveURL: notificationsURL,
    includeCookieHeader: true,
    csrf: false,
    errorMessage: 'Не удалось обновить настройки уведомлений',
  };
}

function requestNotifications<T>(path: string, options: RequestOptions = {}) {
  return apiRequest<T>(path, notificationRequestOptions(options));
}

function requestNotificationsMeta<T>(
  path: string,
  options: RequestOptions = {},
) {
  return apiRequestMeta<T>(path, notificationRequestOptions(options));
}

export const notificationsApi = {
  getNotifications() {
    return requestNotifications<SocialNotification[]>('/notifications', {
      cacheKey: apiCacheKey('notifications', 'list'),
    });
  },

  async getNotificationsPage(params: { limit?: number; cursor?: string } = {}) {
    const query = new URLSearchParams();
    query.set('limit', String(params.limit ?? 30));
    if (params.cursor) {
      query.set('cursor', params.cursor);
    }
    const response = await requestNotificationsMeta<SocialNotification[]>(
      `/notifications?${query.toString()}`,
      {
        cacheKey: apiCacheKey(
          'notifications',
          `page:${params.cursor ?? 'first'}:${params.limit ?? 30}`,
        ),
      },
    );
    const nextCursor = response.headers['x-next-cursor'] || null;
    return {
      notifications: Array.isArray(response.data) ? response.data : [],
      next_cursor: nextCursor,
      has_more: nextCursor !== null,
      unseen_count: Number(response.headers['x-unseen-count']) || 0,
    };
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
    await requestNotifications<{ status: string }>(
      '/notifications/read-matching',
      {
        method: 'PATCH',
        body: payload,
      },
    );
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
