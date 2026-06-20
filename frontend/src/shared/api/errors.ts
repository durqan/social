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
    'image must be jpeg, png or webp': 'Картинка должна быть в формате JPG, PNG, WebP или GIF.',
    'invalid image': 'Файл поврежден или не является корректной картинкой.',
    'failed to read image': 'Не удалось прочитать картинку. Попробуйте выбрать другой файл.',
    'failed to save image': 'Не удалось сохранить картинку. Попробуйте еще раз.',
    'too many images': 'Можно прикрепить максимум 5 картинок за раз.',
    'file is required': 'Выберите файл.',
    'file is empty': 'Файл пустой. Выберите другой файл.',
    'file type is not allowed': 'Этот тип файла нельзя отправлять в чат.',
    'file content does not match attachment type': 'Файл не соответствует выбранному типу вложения.',
    'file content does not match content type': 'Файл поврежден или имеет неверный MIME-тип.',
    'file content does not match extension': 'Содержимое файла не соответствует расширению.',
    'file content does not match supported document type': 'Документ поврежден или имеет неподдерживаемый формат.',
    'message attachments are too large': 'Общий размер вложений не должен превышать 75 МБ.',
    'too many attachments': 'Можно прикрепить максимум 5 файлов за раз.',
    'video is too large': 'Видео слишком большое. Максимум 150 МБ.',
    'audio is too large': 'Аудио слишком большое. Максимум 25 МБ.',
    'file is too large': 'Файл слишком большой. Максимум 25 МБ.',
    'invalid json file': 'JSON-файл поврежден или имеет неверный формат.',
    'invalid zip file': 'ZIP-файл поврежден или имеет неверный формат.',
    'failed to read file': 'Не удалось прочитать файл. Попробуйте выбрать другой файл.',
    'failed to save file': 'Не удалось сохранить файл. Попробуйте еще раз.',
    'unsupported attachment type': 'Этот тип вложения не поддерживается.',
    'cannot mix attachments and voice attachments': 'Голосовое сообщение нельзя отправить вместе с другими вложениями.',
    'cannot mix image and voice attachments': 'Голосовое сообщение нельзя отправить вместе с картинками.',
    'cannot mix video note with other attachments': 'Кружок нельзя отправить вместе с другими вложениями.',
    'only one voice attachment is supported': 'Можно отправить только одно голосовое сообщение за раз.',
    'only one video note attachment is supported': 'Можно отправить только один кружок за раз.',
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
    'video note is required': 'Запишите кружок.',
    'video note is too large': 'Кружок слишком большой. Максимум 25 МБ.',
    'video note must be webm or mp4': 'Кружок должен быть в формате WebM или MP4.',
    'video note content does not match content type': 'Файл поврежден или не является корректным видео.',
    'invalid video note': 'Файл поврежден или не является корректным видео.',
    'failed to read video note': 'Не удалось прочитать кружок. Попробуйте записать еще раз.',
    'failed to save video note': 'Не удалось сохранить кружок. Попробуйте еще раз.',
    'video note duration is required': 'Не удалось определить длительность кружка.',
    'video note is too long': 'Кружок слишком длинный. Максимум 60 секунд.',
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
