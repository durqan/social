import { getApiError } from '../api/errors.js';

export type RegisterFormErrors = {
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    general?: string;
};

export function loginErrorMessage(error: unknown) {
    const apiError = getApiError(error);

    if (apiError.error) {
        return apiError.error;
    }
    if (apiError.message) {
        return apiError.message;
    }
    if (apiError.networkError) {
        return 'Ошибка сети. Проверьте подключение к серверу';
    }

    return 'Неверный email или пароль';
}

export function registerErrors(error: unknown): RegisterFormErrors {
    const apiError = getApiError(error);
    const message = apiError.error || apiError.message || '';

    if (apiError.networkError) {
        return { general: 'Ошибка сети. Проверьте подключение к серверу' };
    }
    if (!message) {
        return { general: 'Произошла неизвестная ошибка. Попробуйте позже' };
    }
    if (message.includes('Password') && message.includes('min')) {
        return { password: 'Пароль слишком короткий (минимум 6 символов)' };
    }
    if (message.includes('duplicate') || message.includes('already exists')) {
        return { email: 'Пользователь с таким email уже существует' };
    }
    if (message.includes('Email') || message.includes('email')) {
        return { email: message.includes('format') ? 'Некорректный формат email' : message };
    }
    if (message.includes('Name')) {
        return { name: 'Имя обязательно для заполнения' };
    }
    if (message.includes('password')) {
        return { password: message };
    }

    return { general: message };
}
