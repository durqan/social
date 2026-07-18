import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import CookieManager from '@preeternal/react-native-cookie-manager';

import { API_BASE_URL, apiURL } from '../config/env';
import { logDev } from '../utils/logger';

type HTTPMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type ApiErrorKind =
  | 'timeout'
  | 'offline'
  | 'aborted'
  | 'client'
  | 'server'
  | 'network';

export type RequestOptions = {
  method?: HTTPMethod;
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  cacheKey?: string;
  allowStaleOnError?: boolean;
  resolveURL?: (path: string) => string;
  includeCookieHeader?: boolean;
  csrf?: boolean;
  errorMessage?: string;
};

const unsafeMethods = new Set<HTTPMethod>(['POST', 'PATCH', 'PUT', 'DELETE']);
const defaultRequestTimeoutMs = 12000;
const defaultRetryCount = 2;
const retryBaseDelayMs = 450;
const retryJitterMs = 180;
const cacheStoragePrefix = '@social/api-cache:v1:';
const memoryCacheTtlMs = 5 * 60 * 1000;
const memoryCacheMaxEntries = 100;

let csrfRefresh: Promise<string> | null = null;
let sessionRefresh: Promise<void> | null = null;
const authInvalidHandlers = new Set<(error: unknown) => void>();
const memoryCache = new Map<string, CachedApiResponse<unknown>>();
let networkOffline = false;

NetInfo.addEventListener(state => {
  networkOffline =
    state.isConnected === false || state.isInternetReachable === false;
});

export class ApiError extends Error {
  status: number;
  details?: unknown;
  kind: ApiErrorKind;

  constructor(
    status: number,
    message: string,
    details?: unknown,
    kind: ApiErrorKind = status >= 500 ? 'server' : 'client',
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.kind = kind;
  }
}

export type ApiResponseMeta<T> = {
  data: T;
  fromCache: boolean;
  stale: boolean;
  headers: Record<string, string>;
};

type CachedApiResponse<T> = {
  data: T;
  cachedAt: number;
  headers?: Record<string, string>;
};

type FetchPolicyOptions = {
  method?: HTTPMethod;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryCount?: number;
};

function cacheStorageKey(cacheKey: string) {
  return `${cacheStoragePrefix}${cacheKey}`;
}

export function apiCacheKey(scope: string, key: string) {
  return `${scope}:${key}`;
}

export async function readCachedApiData<T>(cacheKey?: string) {
  if (!cacheKey) {
    return null;
  }

  const memoryEntry = memoryCache.get(cacheKey) as
    | CachedApiResponse<T>
    | undefined;
  if (memoryEntry && Date.now() - memoryEntry.cachedAt <= memoryCacheTtlMs) {
    memoryCache.delete(cacheKey);
    memoryCache.set(cacheKey, memoryEntry as CachedApiResponse<unknown>);
    return memoryEntry;
  }

  try {
    const raw = await AsyncStorage.getItem(cacheStorageKey(cacheKey));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedApiResponse<T>;
    if (!parsed || typeof parsed.cachedAt !== 'number') {
      return null;
    }
    rememberCachedResponse(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCachedApiData<T>(
  cacheKey: string | undefined,
  data: T,
  headers: Record<string, string> = {},
) {
  if (!cacheKey) {
    return;
  }

  const entry: CachedApiResponse<T> = {
    data,
    cachedAt: Date.now(),
    headers,
  };
  rememberCachedResponse(cacheKey, entry);

  try {
    await AsyncStorage.setItem(
      cacheStorageKey(cacheKey),
      JSON.stringify(entry),
    );
  } catch {
    // Cache writes are best-effort and must not fail the user action.
  }
}

function rememberCachedResponse<T>(
  cacheKey: string,
  entry: CachedApiResponse<T>,
) {
  memoryCache.delete(cacheKey);
  memoryCache.set(cacheKey, entry as CachedApiResponse<unknown>);
  while (memoryCache.size > memoryCacheMaxEntries) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    memoryCache.delete(oldestKey);
  }
}

function shouldUseStaleCache(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.kind === 'offline' ||
      error.kind === 'timeout' ||
      error.kind === 'network' ||
      error.kind === 'server')
  );
}

function classifyStatus(status: number): ApiErrorKind {
  if (status >= 500) {
    return 'server';
  }
  return 'client';
}

function abortErrorKind(
  externalSignal: AbortSignal | undefined,
  timedOut: boolean,
): ApiErrorKind {
  if (externalSignal?.aborted) {
    return 'aborted';
  }
  return timedOut ? 'timeout' : 'network';
}

function abortErrorMessage(kind: ApiErrorKind) {
  if (kind === 'timeout') {
    return 'request timeout';
  }
  if (kind === 'aborted') {
    return 'request aborted';
  }
  if (kind === 'offline') {
    return 'network offline';
  }
  return 'network request failed';
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function retryDelay(attempt: number) {
  return (
    retryBaseDelayMs * 2 ** attempt + Math.floor(Math.random() * retryJitterMs)
  );
}

async function fetchOnceWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromExternalSignal = () => controller.abort();

  if (signal?.aborted) {
    clearTimeout(timeout);
    throw new ApiError(0, 'request aborted', undefined, 'aborted');
  }

  signal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const kind = networkOffline ? 'offline' : abortErrorKind(signal, timedOut);
    if (controller.signal.aborted || signal?.aborted) {
      throw new ApiError(0, abortErrorMessage(kind), undefined, kind);
    }
    throw new ApiError(
      0,
      error instanceof Error ? error.message : 'network request failed',
      error,
      'network',
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

export async function fetchWithNetworkPolicy(
  url: string,
  init: RequestInit = {},
  options: FetchPolicyOptions = {},
) {
  const method =
    options.method ?? ((init.method as HTTPMethod | undefined) || 'GET');
  const retryCount =
    method === 'GET' ? options.retryCount ?? defaultRetryCount : 0;

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetchOnceWithTimeout(
        url,
        {
          ...init,
          method,
        },
        options.signal,
        options.timeoutMs ?? defaultRequestTimeoutMs,
      );

      if (method === 'GET' && response.status >= 500 && attempt < retryCount) {
        await delay(retryDelay(attempt));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof ApiError) ||
        error.kind === 'aborted' ||
        method !== 'GET' ||
        attempt >= retryCount
      ) {
        throw error;
      }
      if (networkOffline) {
        throw new ApiError(0, 'network offline', error, 'offline');
      }
      await delay(retryDelay(attempt));
    }
  }

  throw lastError;
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

export function onAuthInvalid(handler: (error: unknown) => void) {
  authInvalidHandlers.add(handler);
  return () => {
    authInvalidHandlers.delete(handler);
  };
}

function notifyAuthInvalid(error: unknown) {
  authInvalidHandlers.forEach(handler => {
    try {
      handler(error);
    } catch {
      // Auth invalidation is best-effort; one broken subscriber must not block others.
    }
  });
}

async function ensureCSRFToken() {
  const existingToken = await readCookie('csrf_token');
  if (existingToken) {
    return existingToken;
  }

  csrfRefresh ??= fetchWithNetworkPolicy(
    apiURL('/auth/csrf'),
    {
      credentials: 'include',
    },
    {
      method: 'GET',
    },
  )
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
    path.includes('/auth/forgot-password') ||
    path.includes('/auth/reset-password') ||
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

async function buildApiError(response: Response, fallback?: string) {
  const payload = await readResponseBody(response);
  return new ApiError(
    response.status,
    errorMessageFromPayload(payload, fallback ?? `HTTP ${response.status}`),
    payload,
    classifyStatus(response.status),
  );
}

export async function refreshSession() {
  if (sessionRefresh) {
    logDev('[SocialMobile] auth refresh reused existing promise');
    return sessionRefresh;
  }

  logDev('[SocialMobile] auth refresh started');
  sessionRefresh = ensureCSRFToken()
    .then(token =>
      fetchWithNetworkPolicy(
        apiURL('/auth/refresh'),
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'X-CSRF-Token': token,
          },
        },
        {
          method: 'POST',
        },
      ),
    )
    .then(async response => {
      if (!response.ok) {
        throw await buildApiError(response);
      }
      logDev('[SocialMobile] auth refresh ok');
    })
    .catch(error => {
      logDev('[SocialMobile] auth refresh failed', {
        status: error instanceof ApiError ? error.status : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
  return (await apiRequestMeta<T>(path, options)).data;
}

export async function apiRequestMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponseMeta<T>> {
  const method = options.method ?? 'GET';
  const cacheKey = method === 'GET' ? options.cacheKey : undefined;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.includeCookieHeader) {
    const cookieHeader = await getCookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  }
  let body: string | FormData | undefined;

  if (unsafeMethods.has(method) && options.csrf !== false) {
    headers['X-CSRF-Token'] = await ensureCSRFToken();
  }

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchWithNetworkPolicy(
      (options.resolveURL ?? apiURL)(path),
      {
        method,
        headers,
        body,
        credentials: 'include',
      },
      {
        method,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
      },
    );
  } catch (error) {
    if (
      method === 'GET' &&
      cacheKey &&
      options.allowStaleOnError !== false &&
      shouldUseStaleCache(error)
    ) {
      const cached = await readCachedApiData<T>(cacheKey);
      if (cached) {
        return {
          data: cached.data,
          fromCache: true,
          stale: true,
          headers: cached.headers ?? {},
        };
      }
    }
    throw error;
  }

  if (response.status === 401 && !options.retry && !shouldSkipRefresh(path)) {
    logDev('[SocialMobile] request 401', { path, method });
    try {
      await refreshSession();
      return apiRequestMeta<T>(path, {
        ...options,
        retry: true,
      });
    } catch (refreshError) {
      if (
        refreshError instanceof ApiError &&
        (refreshError.status === 401 || refreshError.status === 403)
      ) {
        notifyAuthInvalid(refreshError);
      }
      throw refreshError;
    }
  }

  if (!response.ok) {
    const error = await buildApiError(response, options.errorMessage);
    if (
      method === 'GET' &&
      cacheKey &&
      options.allowStaleOnError !== false &&
      shouldUseStaleCache(error)
    ) {
      const cached = await readCachedApiData<T>(cacheKey);
      if (cached) {
        return {
          data: cached.data,
          fromCache: true,
          stale: true,
          headers: cached.headers ?? {},
        };
      }
    }
    throw error;
  }

  if (response.status === 204) {
    return {
      data: undefined as T,
      fromCache: false,
      stale: false,
      headers: responseHeaders(response),
    };
  }

  const payload = await readResponseBody(response);
  const responseHeaderValues = responseHeaders(response);
  writeCachedApiData(cacheKey, payload as T, responseHeaderValues).catch(
    () => undefined,
  );
  return {
    data: payload as T,
    fromCache: false,
    stale: false,
    headers: responseHeaderValues,
  };
}

function responseHeaders(response: Response) {
  const values: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    values[key.toLowerCase()] = value;
  });
  return values;
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
    'network offline':
      'Нет подключения к интернету. Данные обновятся после восстановления сети.',
    'request timeout':
      'Сервер отвечает слишком долго. Проверьте интернет или попробуйте позже.',
    'request aborted': 'Запрос отменен.',
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
    'you can only delete your own posts': 'Можно удалять только свои посты.',
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
    'image must be jpeg, png or webp':
      'Поддерживаются только JPEG, PNG, WebP и GIF',
    'file is required': 'Выберите файл',
    'file is empty': 'Файл пустой. Выберите другой файл.',
    'file type is not allowed': 'Этот тип файла нельзя отправлять в чат',
    'file content does not match attachment type':
      'Файл не соответствует выбранному типу вложения',
    'file content does not match content type':
      'Файл поврежден или имеет неверный MIME-тип',
    'file content does not match extension':
      'Содержимое файла не соответствует расширению',
    'file content does not match supported document type':
      'Документ поврежден или имеет неподдерживаемый формат',
    'message attachments are too large':
      'Общий размер вложений не должен превышать 500 МБ',
    'too many attachments': 'Можно прикрепить максимум 5 файлов за раз',
    'video is too large': 'Видео должно быть не больше 500 МБ',
    'audio is too large': 'Аудио должно быть не больше 100 МБ',
    'file is too large': 'Файл должен быть не больше 100 МБ',
    'invalid json file': 'JSON-файл поврежден или имеет неверный формат',
    'invalid zip file': 'ZIP-файл поврежден или имеет неверный формат',
    'failed to read file': 'Не удалось прочитать файл. Попробуйте снова.',
    'failed to save file': 'Не удалось сохранить файл. Попробуйте позже.',
    'unsupported attachment type': 'Этот тип вложения не поддерживается',
    'cannot mix attachments and voice attachments':
      'Голосовое сообщение нельзя отправить вместе с другими вложениями',
    'cannot mix image and voice attachments':
      'Голосовое сообщение нельзя отправить вместе с изображениями',
    'cannot mix video note with other attachments':
      'Видео-сообщение нельзя отправить вместе с другими вложениями',
    'only one voice attachment is supported':
      'Можно отправить только одно голосовое сообщение за раз',
    'only one video note attachment is supported':
      'Можно отправить только одно видео-сообщение за раз',
    'voice is required': 'Запишите голосовое сообщение',
    'voice is too large': 'Голосовое сообщение должно быть не больше 100 МБ',
    'voice must be webm, ogg or m4a':
      'Голосовое сообщение должно быть в формате WebM, Ogg или M4A',
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
    'video note is required': 'Запишите видео-сообщение',
    'video note is too large': 'Видео-сообщение должно быть не больше 100 МБ',
    'video note must be webm or mp4':
      'Видео-сообщение должно быть в формате WebM или MP4',
    'video note content does not match content type':
      'Файл поврежден или не является корректным видео',
    'invalid video note': 'Файл поврежден или не является корректным видео',
    'failed to read video note':
      'Не удалось прочитать видео-сообщение. Попробуйте записать снова.',
    'failed to save video note':
      'Не удалось сохранить видео-сообщение. Попробуйте позже.',
    'video note duration is required':
      'Не удалось определить длительность видео-сообщения',
    'video note is too long': 'Видео-сообщение должно быть не длиннее 5 минут',
    'avatar is too large': 'Аватар должен быть не больше 10 МБ',
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
