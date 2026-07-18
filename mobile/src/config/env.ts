declare const process:
  | {
      env: {
        SOCIAL_API_BASE_URL?: string;
        SOCIAL_TURN_URLS?: string;
        SOCIAL_TURN_USERNAME?: string;
        SOCIAL_TURN_CREDENTIAL?: string;
        SOCIAL_WEBRTC_FORCE_RELAY?: string;
      };
    }
  | undefined;

const defaultApiBaseURL = 'https://durqan.ru/api';
const configuredApiBaseURL =
  typeof process !== 'undefined' ? process.env.SOCIAL_API_BASE_URL : undefined;

function envValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export const API_BASE_URL = (
  configuredApiBaseURL?.trim() || defaultApiBaseURL
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
  typeof process !== 'undefined'
    ? envValue(process.env.SOCIAL_TURN_USERNAME)
    : undefined;

export const TURN_CREDENTIAL =
  typeof process !== 'undefined'
    ? envValue(process.env.SOCIAL_TURN_CREDENTIAL)
    : undefined;

export const WEBRTC_FORCE_RELAY =
  __DEV__ &&
  typeof process !== 'undefined' &&
  envValue(process.env.SOCIAL_WEBRTC_FORCE_RELAY)?.toLowerCase() === 'true';

export function apiURL(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
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
