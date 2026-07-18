declare const process:
  | {
      env: {
        SOCIAL_API_BASE_URL?: string;
      };
    }
  | undefined;

const defaultApiBaseURL = 'https://durqan.ru/api';
const configuredApiBaseURL =
  typeof process !== 'undefined' ? process.env.SOCIAL_API_BASE_URL : undefined;

export const API_BASE_URL = (
  configuredApiBaseURL?.trim() || defaultApiBaseURL
).replace(/\/+$/, '');

export const WS_URL = `${API_BASE_URL.replace(/\/api$/, '')
  .replace(/^http:/, 'ws:')
  .replace(/^https:/, 'wss:')}/ws`;

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
