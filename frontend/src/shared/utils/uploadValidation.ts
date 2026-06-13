import {
    CHAT_IMAGE_MIME_TYPES,
    CHAT_VIDEO_NOTE_MIME_TYPES,
    CHAT_VOICE_MIME_TYPE,
    chatImageMaxCount,
    chatImageMaxSize,
    chatVideoNoteMaxDurationSeconds,
    chatVideoNoteMaxSize,
    chatVoiceMaxDurationSeconds,
    chatVoiceMaxSize,
    formatDuration,
    formatFileSize,
} from '@social/shared';

export const avatarMaxSize = 5 * 1024 * 1024;

const imageTypes = new Set<string>(CHAT_IMAGE_MIME_TYPES);
const voiceTypes = new Set([CHAT_VOICE_MIME_TYPE, 'audio/ogg']);
const videoNoteTypes = new Set<string>(CHAT_VIDEO_NOTE_MIME_TYPES);

export {
    chatImageMaxCount,
    chatImageMaxSize,
    chatVideoNoteMaxDurationSeconds,
    chatVideoNoteMaxSize,
    chatVoiceMaxDurationSeconds,
    chatVoiceMaxSize,
    formatDuration,
    formatFileSize,
};

export function validateImageFile(file: File, maxSize: number) {
    if (file.size <= 0) {
        return 'Файл пустой. Выберите другое изображение.';
    }

    if (!imageTypes.has(file.type)) {
        return 'Поддерживаются только JPG, PNG или WebP.';
    }

    if (file.size > maxSize) {
        return `Файл слишком большой: ${formatFileSize(file.size)}. Максимум ${formatFileSize(maxSize)}.`;
    }

    return '';
}

export function filesFromDataTransfer(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.files || []);
}

export function imageFilesFromClipboard(dataTransfer: DataTransfer) {
    const itemFiles = Array.from(dataTransfer.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null && file.type.startsWith('image/'));

    if (itemFiles.length) {
        return itemFiles;
    }

    return Array.from(dataTransfer.files || [])
        .filter(file => file.type.startsWith('image/'));
}

export function dataTransferHasFiles(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.items || []).some(item => item.kind === 'file') ||
        Array.from(dataTransfer.files || []).length > 0;
}

export function dataTransferHasImages(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.items || []).some(item => item.kind === 'file' && item.type.startsWith('image/')) ||
        Array.from(dataTransfer.files || []).some(file => file.type.startsWith('image/'));
}

export function validateChatImages(files: File[]) {
    if (files.length > chatImageMaxCount) {
        return `Можно прикрепить максимум ${chatImageMaxCount} картинок за раз.`;
    }

    for (const file of files) {
        const error = validateImageFile(file, chatImageMaxSize);
        if (error) {
            return `${file.name || 'Изображение'}: ${error}`;
        }
    }

    return '';
}

export function validateVoiceFile(file: File, durationSeconds: number) {
    if (file.size <= 0) {
        return 'Голосовое сообщение пустое. Попробуйте записать еще раз.';
    }

    if (!voiceTypes.has(file.type)) {
        return 'Поддерживаются только голосовые сообщения WebM или Ogg.';
    }

    if (file.size > chatVoiceMaxSize) {
        return `Голосовое сообщение слишком большое: ${formatFileSize(file.size)}. Максимум ${formatFileSize(chatVoiceMaxSize)}.`;
    }

    if (durationSeconds < 1) {
        return 'Голосовое сообщение слишком короткое (минимум 1 секунда).';
    }

    if (durationSeconds > chatVoiceMaxDurationSeconds) {
        return `Голосовое сообщение должно быть не длиннее ${formatDuration(chatVoiceMaxDurationSeconds)}.`;
    }

    return '';
}

export function validateVideoNoteFile(file: File, durationSeconds: number) {
    if (file.size <= 0) {
        return 'Видео-сообщение пустое. Попробуйте записать еще раз.';
    }

    if (!videoNoteTypes.has(file.type)) {
        return 'Поддерживаются только видео-сообщения WebM или MP4.';
    }

    if (file.size > chatVideoNoteMaxSize) {
        return `Видео-сообщение слишком большое: ${formatFileSize(file.size)}. Максимум ${formatFileSize(chatVideoNoteMaxSize)}.`;
    }

    if (durationSeconds < 1) {
        return 'Видео-сообщение слишком короткое (минимум 1 секунда).';
    }

    if (durationSeconds > chatVideoNoteMaxDurationSeconds) {
        return `Видео-сообщение должно быть не длиннее ${formatDuration(chatVideoNoteMaxDurationSeconds)}.`;
    }

    return '';
}

export async function compressChatImage(file: File) {
    if (!file.type.startsWith('image/')) {
        return file;
    }

    const maxSide = 1600;
    const quality = 0.82;

    try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
            bitmap.close();
            return file;
        }

        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
        });

        if (!blob || blob.size >= file.size) {
            return file;
        }

        const name = file.name.replace(/\.[^.]+$/, '') || 'chat-image';
        return new File([blob], `${name}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
        });
    } catch {
        return file;
    }
}

export function uploadErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}
