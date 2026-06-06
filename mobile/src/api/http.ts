import CookieManager from '@preeternal/react-native-cookie-manager';

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

  if (response.status === 401 && !options.retry && !shouldSkipRefresh(path)) {
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

export function toQueryString(
  params: Record<string, string | number | undefined>,
) {
  const parts = Object.entries(params)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function getApiErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : '';
  const normalized = message.toLowerCase();

  const translations: Record<string, string> = {
    'invalid email or password': 'Неверный email или пароль',
    'user with this email already exists':
      'Пользователь с таким email уже есть',
    'registration failed': 'Регистрация отклонена',
    unauthorized: 'Нужно войти в аккаунт',
    'authorization required': 'Нужно войти в аккаунт',
    'invalid or expired token': 'Сессия истекла, войдите снова',
    'csrf token required': 'Не удалось подтвердить сессию. Повторите запрос',
    'invalid csrf token': 'Сессия устарела. Повторите запрос',
    'не удалось получить csrf token':
      'Не удалось подтвердить сессию. Повторите запрос',
    'backend не выдал csrf token':
      'Не удалось подтвердить сессию. Повторите запрос',
    'network request failed':
      'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.',
    'failed to fetch':
      'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.',
    'load failed':
      'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.',
    'the internet connection appears to be offline':
      'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.',
    'internal server error': 'Сервер временно недоступен. Попробуйте позже.',
    'too many requests': 'Слишком много попыток. Попробуйте позже.',
    'failed to get conversations':
      'Не удалось загрузить список чатов. Попробуйте обновить экран.',
    'failed to fetch posts':
      'Не удалось загрузить посты. Попробуйте обновить экран.',
    'failed to create post': 'Не удалось опубликовать пост. Попробуйте позже.',
    'failed to update post': 'Не удалось сохранить пост. Попробуйте позже.',
    'failed to delete post': 'Не удалось удалить пост. Попробуйте позже.',
    'failed to fetch comments':
      'Не удалось загрузить комментарии. Попробуйте позже.',
    'failed to create comment':
      'Не удалось отправить комментарий. Попробуйте позже.',
    'failed to toggle like': 'Не удалось обновить лайк. Попробуйте позже.',
    'post content must be between 1 and 500 characters':
      'Пост должен быть от 1 до 500 символов.',
    'comment content must be between 1 and 500 characters':
      'Комментарий должен быть от 1 до 500 символов.',
    'you can only edit your own posts':
      'Можно редактировать только свои посты.',
    'you can only delete your own posts':
      'Можно удалять только свои посты.',
    'failed to pin conversation':
      'Не удалось закрепить диалог. Попробуйте позже.',
    'failed to unpin conversation':
      'Не удалось снять закреп диалога. Попробуйте позже.',
    'you are not a participant in this conversation':
      'У вас нет доступа к этому диалогу.',
    'failed to get messages':
      'Не удалось загрузить сообщения. Попробуйте обновить экран.',
    'failed to send message':
      'Не удалось отправить сообщение. Попробуйте позже.',
    'failed to mark as read':
      'Не удалось обновить статус прочтения. Попробуйте позже.',
    'failed to update message':
      'Не удалось обновить сообщение. Попробуйте позже.',
    'failed to delete message':
      'Не удалось удалить сообщение. Попробуйте позже.',
    'failed to get friends list':
      'Не удалось загрузить список друзей. Попробуйте обновить экран.',
    'failed to get friend requests':
      'Не удалось загрузить заявки в друзья. Попробуйте обновить экран.',
    'friend request not found': 'Заявка уже недоступна.',
    'failed to accept friend request':
      'Не удалось принять заявку. Попробуйте позже.',
    'failed to remove friend':
      'Не удалось обновить список друзей. Попробуйте позже.',
    'friend request already sent or you are already friends':
      'Заявка уже отправлена или пользователь уже в друзьях.',
    'failed to send friend request':
      'Не удалось отправить заявку. Попробуйте позже.',
    'you cannot add yourself as a friend': 'Нельзя добавить себя в друзья.',
    'failed to search users':
      'Не удалось найти пользователей. Попробуйте позже.',
    'query parameter is required': 'Введите имя или email для поиска.',
    'Подтвердите email, чтобы продолжить':
      'Подтвердите email, чтобы пользоваться всеми возможностями',
    'can only message accepted friends':
      'Сообщения можно отправлять только друзьям',
    'message content or image is required':
      'Введите сообщение или выберите изображение',
    'message content or attachment is required':
      'Введите сообщение или добавьте вложение',
    'message content must be 1000 characters or less':
      'Сообщение должно быть не длиннее 1000 символов',
    'image is too large': 'Изображение должно быть не больше 10 МБ',
    'image must be jpeg, png or webp': 'Поддерживаются только JPEG, PNG и WebP',
    'unsupported attachment type': 'Этот тип вложения не поддерживается',
    'cannot mix image and voice attachments':
      'Голосовое сообщение нельзя отправить вместе с изображениями',
    'only one voice attachment is supported':
      'Можно отправить только одно голосовое сообщение за раз',
    'voice is required': 'Запишите голосовое сообщение',
    'voice is too large': 'Голосовое сообщение должно быть не больше 12 МБ',
    'voice must be webm or ogg':
      'Голосовое сообщение должно быть в формате WebM или Ogg',
    'voice content does not match content type':
      'Файл поврежден или не является корректным аудио',
    'invalid voice': 'Файл поврежден или не является корректным аудио',
    'failed to read voice':
      'Не удалось прочитать голосовое сообщение. Попробуйте записать снова.',
    'failed to save voice':
      'Не удалось сохранить голосовое сообщение. Попробуйте позже.',
    'voice duration is required':
      'Не удалось определить длительность голосового сообщения',
    'voice is too long': 'Голосовое сообщение должно быть не длиннее 5 минут',
    'avatar is too large': 'Аватар должен быть не больше 5 МБ',
    'avatar is required': 'Выберите изображение для аватара',
    'avatar must be jpeg, png or webp':
      'Поддерживаются только JPEG, PNG и WebP',
    'failed to save avatar': 'Не удалось сохранить аватар. Попробуйте позже.',
    'email already exists': 'Пользователь с таким email уже есть',
    'no valid fields to update': 'Измените хотя бы одно поле',
    'failed to fetch updated user':
      'Профиль сохранен, но не удалось обновить данные на экране.',
    'не удалось обновить настройки уведомлений':
      'Не удалось обновить уведомления. Попробуйте позже.',
  };

  const translated = translations[message] ?? translations[normalized];
  if (translated) {
    return translated;
  }

  if (!message) {
    return 'Что-то пошло не так. Попробуйте позже.';
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Сессия истекла, войдите снова';
    }

    if (error.status === 403) {
      return 'Недостаточно прав для этого действия';
    }

    if (error.status === 404) {
      return 'Данные не найдены';
    }

    if (error.status >= 500) {
      return 'Сервер временно недоступен. Попробуйте позже.';
    }
  }

  if (looksTechnical(message)) {
    return 'Что-то пошло не так. Попробуйте позже.';
  }

  return message;
}

function looksTechnical(message: string) {
  return (
    /^HTTP \d{3}$/i.test(message) ||
    /^https?:\/\//i.test(message) ||
    /\/api\//i.test(message) ||
    /(?:Type|Syntax|Reference)Error/i.test(message) ||
    /JSON|stack|endpoint/i.test(message) ||
    message.trim().startsWith('{') ||
    message.trim().startsWith('[')
  );
}
