import { AxiosError } from 'axios';

type ErrorResponse = {
    error?: string;
    message?: string;
};

export const getApiError = (error: unknown): ErrorResponse & { networkError: boolean } => {
    if (error instanceof AxiosError) {
        const data = error.response?.data;
        const responseError = typeof data === 'object' && data !== null && 'error' in data
            ? String(data.error)
            : undefined;
        const responseMessage = typeof data === 'object' && data !== null && 'message' in data
            ? String(data.message)
            : undefined;

        return {
            error: responseError,
            message: responseMessage,
            networkError: error.message === 'Network Error',
        };
    }

    return { networkError: false };
};

export const getApiStatus = (error: unknown): number | undefined => {
    if (error instanceof AxiosError) {
        return error.response?.status;
    }
    return undefined;
};

const uploadErrorText: Record<string, string> = {
    'avatar is required': 'Выберите файл аватара.',
    'avatar is too large': 'Аватар слишком большой. Максимум 5 МБ.',
    'avatar must be jpeg, png or webp': 'Аватар должен быть в формате JPG, PNG или WebP.',
    'failed to read avatar': 'Не удалось прочитать файл аватара. Попробуйте выбрать другой файл.',
    'failed to save avatar': 'Не удалось сохранить аватар. Попробуйте еще раз.',
    'image is required': 'Выберите картинку.',
    'image is too large': 'Картинка слишком большая. Максимум 10 МБ.',
    'image must be jpeg, png or webp': 'Картинка должна быть в формате JPG, PNG или WebP.',
    'invalid image': 'Файл поврежден или не является корректной картинкой.',
    'failed to read image': 'Не удалось прочитать картинку. Попробуйте выбрать другой файл.',
    'failed to save image': 'Не удалось сохранить картинку. Попробуйте еще раз.',
    'too many images': 'Можно прикрепить максимум 5 картинок за раз.',
    'unsupported attachment type': 'Этот тип вложения не поддерживается.',
    'cannot mix image and voice attachments': 'Голосовое сообщение нельзя отправить вместе с картинками.',
    'only one voice attachment is supported': 'Можно отправить только одно голосовое сообщение за раз.',
    'message content or attachment is required': 'Введите сообщение или добавьте вложение.',
    'voice is required': 'Запишите голосовое сообщение.',
    'voice is too large': 'Голосовое сообщение слишком большое. Максимум 12 МБ.',
    'voice must be webm or ogg': 'Голосовое сообщение должно быть в формате WebM или Ogg.',
    'voice content does not match content type': 'Файл поврежден или не является корректным аудио.',
    'invalid voice': 'Файл поврежден или не является корректным аудио.',
    'failed to read voice': 'Не удалось прочитать голосовое сообщение. Попробуйте записать еще раз.',
    'failed to save voice': 'Не удалось сохранить голосовое сообщение. Попробуйте еще раз.',
    'voice duration is required': 'Не удалось определить длительность голосового сообщения.',
    'voice is too long': 'Голосовое сообщение слишком длинное. Максимум 5 минут.',
};

export const getUploadErrorMessage = (error: unknown, fallback: string) => {
    const apiError = getApiError(error);
    const raw = apiError.error || apiError.message;

    if (apiError.networkError) {
        return 'Нет соединения с сервером. Проверьте интернет и попробуйте еще раз.';
    }

    if (raw && uploadErrorText[raw]) {
        return uploadErrorText[raw];
    }

    return raw || fallback;
};
