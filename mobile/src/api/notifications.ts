import { notificationsURL } from '../config/env';
import {
  ApiError,
  apiCacheKey,
  fetchWithNetworkPolicy,
  getCookieHeader,
  readCachedApiData,
  refreshSession,
  writeCachedApiData,
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

type NotificationRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  cacheKey?: string;
  allowStaleOnError?: boolean;
};

function shouldUseStale(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.kind === 'offline' ||
      error.kind === 'timeout' ||
      error.kind === 'network' ||
      error.kind === 'server')
  );
}

async function readNotificationResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestNotifications<T>(
  path: string,
  options: NotificationRequestOptions = {},
  retry = true,
): Promise<T> {
  const method = options.method ?? 'GET';
  const cacheKey = method === 'GET' ? options.cacheKey : undefined;
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

  let response: Response;
  try {
    response = await fetchWithNetworkPolicy(
      notificationsURL(path),
      {
        method,
        credentials: 'include',
        headers,
        body,
      },
      {
        method,
        signal: options.signal,
      },
    );
  } catch (error) {
    if (
      cacheKey &&
      options.allowStaleOnError !== false &&
      shouldUseStale(error)
    ) {
      const cached = await readCachedApiData<T>(cacheKey);
      if (cached) {
        return cached.data;
      }
    }
    throw error;
  }

  if (response.status === 401 && retry) {
    await refreshSession();
    return requestNotifications<T>(path, options, false);
  }

  if (!response.ok) {
    const payload = await readNotificationResponse(response);
    const error = new ApiError(
      response.status,
      'Не удалось обновить настройки уведомлений',
      payload,
      response.status >= 500 ? 'server' : 'client',
    );
    if (
      cacheKey &&
      options.allowStaleOnError !== false &&
      shouldUseStale(error)
    ) {
      const cached = await readCachedApiData<T>(cacheKey);
      if (cached) {
        return cached.data;
      }
    }
    throw error;
  }

  const payload = (await readNotificationResponse(response)) as T;
  await writeCachedApiData(cacheKey, payload);
  return payload ?? (undefined as T);
}

export const notificationsApi = {
  getNotifications() {
    return requestNotifications<SocialNotification[]>('/notifications', {
      cacheKey: apiCacheKey('notifications', 'list'),
    });
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
