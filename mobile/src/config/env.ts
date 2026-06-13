export {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VOICE_MAX_BYTES,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
  CHAT_VIDEO_NOTE_MAX_BYTES,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VIDEO_NOTE_MIME_TYPES,
} from '@social/shared';

declare const process:
  | {
      env: {
        SOCIAL_API_BASE_URL?: string;
        SOCIAL_NOTIFICATIONS_BASE_URL?: string;
        SOCIAL_TURN_URLS?: string;
        SOCIAL_TURN_USERNAME?: string;
        SOCIAL_TURN_CREDENTIAL?: string;
      };
    }
  | undefined;

const defaultApiBaseURL = 'http://10.0.2.2:8080';
const configuredApiBaseURL =
  typeof process !== 'undefined' ? process.env.SOCIAL_API_BASE_URL : undefined;
const configuredNotificationsBaseURL =
  typeof process !== 'undefined'
    ? process.env.SOCIAL_NOTIFICATIONS_BASE_URL
    : undefined;

export const API_BASE_URL = (
  configuredApiBaseURL?.trim() || defaultApiBaseURL
).replace(/\/+$/, '');

function deriveNotificationsBaseURL(apiBaseURL: string) {
  try {
    const url = new URL(apiBaseURL);
    if (url.pathname.endsWith('/api')) {
      return `${url.protocol}//${url.host}${url.pathname.replace(
        /\/api$/,
        '/notifications-api',
      )}`.replace(/\/+$/, '');
    }

    if (url.port === '8080') {
      return `${url.protocol}//${url.hostname}:8085${url.pathname}`.replace(
        /\/+$/,
        '',
      );
    }

    return `${url.protocol}//${url.host}/notifications-api`;
  } catch {
    return apiBaseURL.replace(/\/api$/, '/notifications-api');
  }
}

export const NOTIFICATIONS_BASE_URL = (
  configuredNotificationsBaseURL?.trim() ||
  deriveNotificationsBaseURL(API_BASE_URL)
).replace(/\/+$/, '');

export const WS_URL = `${API_BASE_URL.replace(/\/api$/, '')
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:')}/ws`;

export const TURN_URLS =
  typeof process !== 'undefined' && process.env.SOCIAL_TURN_URLS
    ? process.env.SOCIAL_TURN_URLS.split(',')
        .map(url => url.trim())
        .filter(Boolean)
    : [];

export const TURN_USERNAME =
  typeof process !== 'undefined' ? process.env.SOCIAL_TURN_USERNAME : undefined;

export const TURN_CREDENTIAL =
  typeof process !== 'undefined'
    ? process.env.SOCIAL_TURN_CREDENTIAL
    : undefined;

export function apiURL(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function notificationsURL(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${NOTIFICATIONS_BASE_URL}${normalizedPath}`;
}

export function assetURL(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/api/')
    ? path.slice('/api'.length)
    : path.startsWith('/')
    ? path
    : `/${path}`;

  return `${API_BASE_URL}${normalizedPath}`;
}
