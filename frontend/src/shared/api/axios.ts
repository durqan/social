import axios, { AxiosHeaders, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

const apiBaseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
    baseURL: apiBaseURL,
    timeout: 10000,
    withCredentials: true,
});

const unsafeMethods = new Set(['post', 'put', 'patch', 'delete']);
let csrfRefresh: Promise<string> | null = null;
let sessionRefresh: Promise<void> | null = null;

const readCookie = (name: string) => {
    const prefix = `${name}=`;
    return document.cookie
        .split(';')
        .map(cookie => cookie.trim())
        .find(cookie => cookie.startsWith(prefix))
        ?.slice(prefix.length);
};

const ensureCSRFToken = async () => {
    const existingToken = readCookie('csrf_token');
    if (existingToken) return decodeURIComponent(existingToken);

    csrfRefresh ??= axios.get(`${apiBaseURL}/auth/csrf`, {
        withCredentials: true,
    }).then(() => {
        const token = readCookie('csrf_token');
        if (!token) {
            throw new Error('CSRF token was not issued');
        }
        return decodeURIComponent(token);
    }).finally(() => {
        csrfRefresh = null;
    });

    return csrfRefresh;
};

api.interceptors.request.use(async (config) => {
    const headers = AxiosHeaders.from(config.headers);

    const method = config.method?.toLowerCase();
    if (method && unsafeMethods.has(method)) {
        headers.set('X-CSRF-Token', await ensureCSRFToken());
    }

    config.headers = headers;
    return config;
});

type RetriableRequestConfig = InternalAxiosRequestConfig & {
    _retry?: boolean;
};

const refreshSession = async () => {
    sessionRefresh ??= ensureCSRFToken()
        .then(token => axios.post(`${apiBaseURL}/auth/refresh`, undefined, {
            withCredentials: true,
            headers: {
                'X-CSRF-Token': token,
            },
        }))
        .then(() => undefined)
        .finally(() => {
            sessionRefresh = null;
        });

    return sessionRefresh;
};

api.interceptors.response.use(
    (res) => res,
    async (err) => {
        const originalRequest = err.config as RetriableRequestConfig | undefined;
        const requestURL = originalRequest?.url || '';
        const canRefresh = err.response?.status === 401
            && originalRequest
            && !originalRequest._retry
            && !requestURL.includes('/auth/login')
            && !requestURL.includes('/auth/register')
            && !requestURL.includes('/auth/refresh')
            && !requestURL.includes('/auth/verify-email');

        if (canRefresh) {
            originalRequest._retry = true;
            try {
                await refreshSession();
                return api(originalRequest);
            } catch {
                // Fall through to the existing unauthenticated handling.
            }
        }

        if (err.response?.status === 401 && !['/login', '/register', '/verify-email']
            .some(path => window.location.pathname.includes(path))) {
            window.location.href = '/login';
        }
        return Promise.reject(err);
    }
);

export const request = {
    async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return (await api.get<T>(url, config)).data;
    },

    async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return (await api.post<T>(url, data, config)).data;
    },

    async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        return (await api.patch<T>(url, data, config)).data;
    },

    async delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return (await api.delete<T>(url, config)).data;
    },
};

export default api;
