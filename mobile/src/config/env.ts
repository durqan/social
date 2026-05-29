declare const process:
  | {
      env?: {
        SOCIAL_API_BASE_URL?: string;
      };
    }
  | undefined;

const defaultApiBaseURL = 'http://10.0.2.2:8080';
const configuredApiBaseURL =
  typeof process !== 'undefined'
    ? process.env?.SOCIAL_API_BASE_URL
    : undefined;

export const API_BASE_URL = (
  configuredApiBaseURL?.trim() || defaultApiBaseURL
).replace(/\/+$/, '');

export const WS_URL = `${API_BASE_URL.replace(/\/api$/, '')
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:')}/ws`;

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_COUNT = 5;
export const CHAT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

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
