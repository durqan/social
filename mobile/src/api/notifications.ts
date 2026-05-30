import { notificationsURL } from '../config/env';
import { getCookieHeader } from './http';

export type MobilePushTokenPayload = {
  provider: 'fcm';
  platform: 'android';
  token: string;
};

async function requestNotifications(
  path: string,
  options: {
    method: 'POST' | 'DELETE';
    body: unknown;
  },
) {
  const cookieHeader = await getCookieHeader();
  const response = await fetch(notificationsURL(path), {
    method: options.method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookieHeader
        ? {
            Cookie: cookieHeader,
          }
        : {}),
    },
    body: JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw new Error('Не удалось обновить настройки уведомлений');
  }
}

export const notificationsApi = {
  registerMobilePushToken(payload: MobilePushTokenPayload) {
    return requestNotifications('/push/mobile-token', {
      method: 'POST',
      body: payload,
    });
  },

  revokeMobilePushToken(payload: MobilePushTokenPayload) {
    return requestNotifications('/push/mobile-token', {
      method: 'DELETE',
      body: payload,
    });
  },
};
