import { API_BASE_URL } from '../config/api';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
  skipAuthRefresh?: boolean;
};

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function ensureCSRFToken() {
  const response = await fetch(`${API_BASE_URL}/auth/csrf`, {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to get CSRF token');
  }

  const data = await response.json() as { csrf_token?: string };
  if (!data.csrf_token) {
    throw new Error('CSRF token was not issued');
  }

  return data.csrf_token;
}

async function refreshSession() {
  const token = await ensureCSRFToken();
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': token,
    },
  });
  if (!response.ok) {
    throw new Error('Session refresh failed');
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const method = (options.method || 'GET').toUpperCase();
  if (unsafeMethods.has(method)) {
    headers.set('X-CSRF-Token', await ensureCSRFToken());
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      body,
      credentials: 'include',
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

  const isAuthEndpoint = path.startsWith('/auth/login')
    || path.startsWith('/auth/register')
    || path.startsWith('/auth/refresh');
  if (response.status === 401 && !options.skipAuthRefresh && !isAuthEndpoint) {
    await refreshSession();
    return apiRequest<T>(path, { ...options, skipAuthRefresh: true });
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
