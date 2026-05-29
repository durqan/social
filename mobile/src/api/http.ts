import CookieManager from '@react-native-cookies/cookies';

import { API_BASE_URL, apiURL } from '../config/env';

type HTTPMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type RequestOptions = {
  method?: HTTPMethod;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
};

const unsafeMethods = new Set<HTTPMethod>(['POST', 'PATCH', 'PUT', 'DELETE']);

let csrfRefresh: Promise<string> | null = null;
let sessionRefresh: Promise<void> | null = null;

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function readCookie(name: string) {
  const cookies = await CookieManager.get(API_BASE_URL);
  return cookies[name]?.value
    ? decodeCookieValue(cookies[name].value)
    : undefined;
}

export async function getCookieHeader() {
  const cookies = await CookieManager.get(API_BASE_URL);
  return Object.values(cookies)
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export async function clearSessionCookies() {
  await CookieManager.clearAll();
}

export async function ensureCSRFToken() {
  const existingToken = await readCookie('csrf_token');
  if (existingToken) {
    return existingToken;
  }

  csrfRefresh ??= fetch(apiURL('/auth/csrf'), {
    credentials: 'include',
  })
    .then(async response => {
      if (!response.ok) {
        throw new ApiError(response.status, 'Не удалось получить CSRF token');
      }

      const token = await readCookie('csrf_token');
      if (!token) {
        throw new ApiError(500, 'Backend не выдал CSRF token');
      }
      return token;
    })
    .finally(() => {
      csrfRefresh = null;
    });

  return csrfRefresh;
}

function shouldSkipRefresh(path: string) {
  return (
    path.includes('/auth/login') ||
    path.includes('/auth/register') ||
    path.includes('/auth/refresh') ||
    path.includes('/auth/verify-email')
  );
}

async function readResponseBody(response: Response) {
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

function errorMessageFromPayload(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }

  return fallback;
}

async function buildApiError(response: Response) {
  const payload = await readResponseBody(response);
  return new ApiError(
    response.status,
    errorMessageFromPayload(payload, `HTTP ${response.status}`),
    payload,
  );
}

export async function refreshSession() {
  sessionRefresh ??= ensureCSRFToken()
    .then(token =>
      fetch(apiURL('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': token,
        },
      }),
    )
    .then(async response => {
      if (!response.ok) {
        throw await buildApiError(response);
      }
    })
    .finally(() => {
      sessionRefresh = null;
    });

  return sessionRefresh;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  let body: string | FormData | undefined;

  if (unsafeMethods.has(method)) {
    headers['X-CSRF-Token'] = await ensureCSRFToken();
  }

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(apiURL(path), {
    method,
    headers,
    body,
    credentials: 'include',
  });

  if (
    response.status === 401 &&
    !options.retry &&
    !shouldSkipRefresh(path)
  ) {
    try {
      await refreshSession();
      return apiRequest<T>(path, {
        ...options,
        retry: true,
      });
    } catch {
      throw await buildApiError(response);
    }
  }

  if (!response.ok) {
    throw await buildApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await readResponseBody(response);
  return payload as T;
}

export function toQueryString(params: Record<string, string | number | undefined>) {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function getApiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';

  const translations: Record<string, string> = {
    'invalid email or password': 'Неверный email или пароль',
    'user with this email already exists': 'Пользователь с таким email уже есть',
    'registration failed': 'Регистрация отклонена',
    'authorization required': 'Нужно войти в аккаунт',
    'invalid or expired token': 'Сессия истекла, войдите снова',
    'csrf token required': 'Не удалось подтвердить сессию. Повторите запрос',
    'invalid csrf token': 'Сессия устарела. Повторите запрос',
    'can only message accepted friends':
      'Сообщения можно отправлять только друзьям',
    'message content or image is required':
      'Введите сообщение или выберите изображение',
    'message content must be 1000 characters or less':
      'Сообщение должно быть не длиннее 1000 символов',
    'image is too large': 'Изображение должно быть не больше 10 МБ',
    'image must be jpeg, png or webp':
      'Поддерживаются только JPEG, PNG и WebP',
  };

  return translations[message] ?? message;
}
