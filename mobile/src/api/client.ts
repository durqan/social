import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL } from '../config/api';

const tokenKey = 'social.auth.token';

export const tokenStore = {
  get: () => AsyncStorage.getItem(tokenKey),
  set: (token: string) => AsyncStorage.setItem(tokenKey, token),
  clear: () => AsyncStorage.removeItem(tokenKey),
};

export const authHeaders = async () => {
  const token = await tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : undefined;
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await tokenStore.get();
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Backend is not responding. Check EXPO_PUBLIC_API_BASE_URL.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String(data.error) : 'Request failed';
    throw new Error(message);
  }

  return data as T;
}

export function apiAssetURL(path?: string | null) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE_URL}${path.startsWith('/api') ? path.slice(4) : path}`;
}
