import {
    CHAT_ATTACHMENT_MAX_COUNT,
    CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
    CHAT_AUDIO_MAX_BYTES,
    CHAT_AUDIO_MIME_TYPES,
    CHAT_BLOCKED_ATTACHMENT_EXTENSIONS,
    CHAT_FILE_MAX_BYTES,
    CHAT_FILE_MIME_TYPES,
    CHAT_IMAGE_MAX_BYTES,
    CHAT_IMAGE_MIME_TYPES,
    CHAT_VIDEO_MAX_BYTES,
    CHAT_VIDEO_MIME_TYPES,
    CHAT_VIDEO_NOTE_MIME_TYPES,
    CHAT_VOICE_MIME_TYPE,
    chatAttachmentMaxCount,
    chatAttachmentMaxTotalSize,
    chatAudioMaxSize,
    chatFileMaxSize,
    chatImageMaxCount,
    chatImageMaxSize,
    chatVideoMaxSize,
    chatVideoNoteMaxDurationSeconds,
    chatVideoNoteMaxSize,
    chatVoiceMaxDurationSeconds,
    chatVoiceMaxSize,
    formatDuration,
    formatFileSize,
} from '@social/shared';

export const avatarMaxSize = 5 * 1024 * 1024;

const imageTypes = new Set<string>(CHAT_IMAGE_MIME_TYPES);
const videoTypes = new Set<string>(CHAT_VIDEO_MIME_TYPES);
const audioTypes = new Set<string>(CHAT_AUDIO_MIME_TYPES);
const fileTypes = new Set<string>(CHAT_FILE_MIME_TYPES);
const voiceTypes = new Set([CHAT_VOICE_MIME_TYPE, 'audio/ogg']);
const videoNoteTypes = new Set<string>(CHAT_VIDEO_NOTE_MIME_TYPES);
const blockedAttachmentExtensions = new Set<string>(CHAT_BLOCKED_ATTACHMENT_EXTENSIONS);
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const videoExtensions = new Set(['mp4', 'webm', 'mov']);
const audioExtensions = new Set(['mp3', 'm4a', 'wav', 'ogg', 'webm']);
const fileExtensions = new Set(['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'json', 'csv']);

export type ChatAttachmentKind = 'image' | 'video' | 'audio' | 'file';

export const chatAttachmentAccept = [
    ...Array.from(imageTypes),
    ...Array.from(videoTypes),
    ...Array.from(audioTypes),
    ...Array.from(fileTypes),
    ...Array.from(imageExtensions, ext => `.${ext}`),
    ...Array.from(videoExtensions, ext => `.${ext}`),
    ...Array.from(audioExtensions, ext => `.${ext}`),
    ...Array.from(fileExtensions, ext => `.${ext}`),
].join(',');

export {
    chatAttachmentMaxCount,
    chatAttachmentMaxTotalSize,
    chatAudioMaxSize,
    chatFileMaxSize,
    chatImageMaxCount,
    chatImageMaxSize,
    chatVideoMaxSize,
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
        return 'Поддерживаются только JPG, PNG, WebP или GIF.';
    }

    if (file.size > maxSize) {
        return `Файл слишком большой: ${formatFileSize(file.size)}. Максимум ${formatFileSize(maxSize)}.`;
    }

    return '';
}

function fileExtension(file: File) {
    const name = file.name || '';
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index + 1).trim().toLowerCase() : '';
}

export function chatAttachmentKindForFile(file: File): ChatAttachmentKind | null {
    const extension = fileExtension(file);
    const type = (file.type || '').toLowerCase();

    if (blockedAttachmentExtensions.has(extension)) {
        return null;
    }
    if (imageTypes.has(type)) {
        return 'image';
    }
    if (videoTypes.has(type)) {
        return 'video';
    }
    if (audioTypes.has(type)) {
        return 'audio';
    }
    if (fileTypes.has(type)) {
        return 'file';
    }
    if (imageExtensions.has(extension)) {
        return 'image';
    }
    if (videoExtensions.has(extension)) {
        return 'video';
    }
    if (audioExtensions.has(extension)) {
        return 'audio';
    }
    if (fileExtensions.has(extension)) {
        return 'file';
    }
    return null;
}

function maxSizeForAttachmentKind(kind: ChatAttachmentKind) {
    switch (kind) {
        case 'image':
            return CHAT_IMAGE_MAX_BYTES;
        case 'video':
            return CHAT_VIDEO_MAX_BYTES;
        case 'audio':
            return CHAT_AUDIO_MAX_BYTES;
        case 'file':
            return CHAT_FILE_MAX_BYTES;
        default:
            return CHAT_FILE_MAX_BYTES;
    }
}

function attachmentKindLabel(kind: ChatAttachmentKind) {
    switch (kind) {
        case 'image':
            return 'Изображение';
        case 'video':
            return 'Видео';
        case 'audio':
            return 'Аудио';
        default:
            return 'Файл';
    }
}

export function validateChatAttachmentFile(file: File) {
    if (file.size <= 0) {
        return 'Файл пустой. Выберите другой файл.';
    }

    const extension = fileExtension(file);
    if (blockedAttachmentExtensions.has(extension)) {
        return 'Этот тип файла нельзя отправлять в чат.';
    }

    const kind = chatAttachmentKindForFile(file);
    if (!kind) {
        return 'Поддерживаются фото, видео, музыка, PDF/DOC/XLS/ZIP/TXT/JSON/CSV.';
    }

    const maxSize = maxSizeForAttachmentKind(kind);
    if (file.size > maxSize) {
        return `${attachmentKindLabel(kind)} слишком большой: ${formatFileSize(file.size)}. Максимум ${formatFileSize(maxSize)}.`;
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

export function validateChatAttachments(files: File[]) {
    if (files.length > CHAT_ATTACHMENT_MAX_COUNT) {
        return `Можно прикрепить максимум ${CHAT_ATTACHMENT_MAX_COUNT} файлов за раз.`;
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > CHAT_ATTACHMENT_MAX_TOTAL_BYTES) {
        return `Общий размер вложений слишком большой: ${formatFileSize(totalSize)}. Максимум ${formatFileSize(CHAT_ATTACHMENT_MAX_TOTAL_BYTES)}.`;
    }

    for (const file of files) {
        const error = validateChatAttachmentFile(file);
        if (error) {
            return `${file.name || 'Файл'}: ${error}`;
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
    if (!file.type.startsWith('image/') || file.type === 'image/gif') {
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
