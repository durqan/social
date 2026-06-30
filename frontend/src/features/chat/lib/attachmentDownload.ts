import type { MessageAttachment } from "@/shared/types/domain.js";

const apiBaseURL = import.meta.env.VITE_API_BASE_URL || '/api';

type AttachmentMetadata = Record<string, unknown>;

type DownloadableAttachment = MessageAttachment & {
    download_url?: string;
    downloadUrl?: string;
    file_name?: string;
    filename?: string;
    name?: string;
    original_name?: string;
    metadata?: AttachmentMetadata | null;
};

function joinApiURL(path: string) {
    const base = apiBaseURL.replace(/\/+$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
}

function cleanFilename(value: string) {
    const normalized = value.trim().replaceAll('\\', '/').split('/').filter(Boolean).pop() || '';
    const cleaned = Array.from(normalized, char => {
        const code = char.charCodeAt(0);
        if (code < 32) {
            return '';
        }
        return '<>:"/\\|?*'.includes(char) ? '_' : char;
    }).join('');

    return cleaned
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '')
        .slice(0, 180);
}

function normalizeExtension(value?: string | null) {
    const ext = value?.trim().toLowerCase() || '';
    if (!ext) {
        return '';
    }
    const normalized = ext.startsWith('.') ? ext : `.${ext}`;
    return /^[.][a-z0-9]{1,12}$/.test(normalized) ? normalized : '';
}

function extensionFromFilename(filename?: string | null) {
    const name = cleanFilename(filename || '');
    const match = name.match(/(\.[a-z0-9]{1,12})$/i);
    return normalizeExtension(match?.[1]);
}

function extensionFromURL(rawURL?: string | null) {
    if (!rawURL || rawURL.startsWith('blob:')) {
        return '';
    }

    try {
        const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
        const url = new URL(rawURL, base);
        return extensionFromFilename(url.pathname);
    } catch {
        return extensionFromFilename(rawURL.split('?')[0]);
    }
}

function extensionFromMimeType(mimeType?: string | null) {
    const type = mimeType?.split(';')[0]?.trim().toLowerCase();
    switch (type) {
        case 'image/jpeg':
            return '.jpg';
        case 'image/png':
            return '.png';
        case 'image/webp':
            return '.webp';
        case 'image/gif':
            return '.gif';
        case 'video/mp4':
            return '.mp4';
        case 'video/webm':
            return '.webm';
        case 'video/quicktime':
            return '.mov';
        case 'audio/mpeg':
            return '.mp3';
        case 'audio/ogg':
        case 'application/ogg':
            return '.ogg';
        case 'audio/webm':
            return '.webm';
        case 'audio/mp4':
        case 'audio/m4a':
        case 'audio/x-m4a':
            return '.m4a';
        case 'audio/wav':
        case 'audio/x-wav':
            return '.wav';
        case 'application/pdf':
            return '.pdf';
        case 'text/plain':
            return '.txt';
        case 'application/zip':
            return '.zip';
        case 'application/json':
            return '.json';
        case 'text/csv':
            return '.csv';
        default:
            return '';
    }
}

function defaultExtension(attachment: MessageAttachment) {
    switch (attachment.file_type) {
        case 'image':
            return '.jpg';
        case 'video':
            return '.mp4';
        case 'video_note':
            return '.mp4';
        case 'voice':
            return '.webm';
        case 'audio':
            return '.mp3';
        default:
            return '.bin';
    }
}

function metadataString(attachment: DownloadableAttachment, key: string) {
    const value = attachment.metadata?.[key];
    return typeof value === 'string' ? value : '';
}

function attachmentOriginalName(attachment: DownloadableAttachment) {
    return [
        attachment.file_name,
        attachment.filename,
        attachment.name,
        attachment.original_name,
        attachment.original_filename,
        metadataString(attachment, 'filename'),
        metadataString(attachment, 'file_name'),
        metadataString(attachment, 'name'),
        metadataString(attachment, 'original_name'),
        metadataString(attachment, 'original_filename'),
    ]
        .map(value => cleanFilename(value || ''))
        .find(Boolean) || '';
}

function attachmentExtension(attachment: DownloadableAttachment, responseContentType?: string | null) {
    return extensionFromMimeType(attachment.original_mime_type)
        || extensionFromMimeType(attachment.content_type)
        || extensionFromMimeType(metadataString(attachment, 'content_type'))
        || extensionFromMimeType(metadataString(attachment, 'mime_type'))
        || extensionFromMimeType(responseContentType)
        || extensionFromURL(attachment.download_url)
        || extensionFromURL(attachment.downloadUrl)
        || extensionFromURL(attachment.decrypted_file_url)
        || extensionFromURL(attachment.file_url)
        || defaultExtension(attachment);
}

function attachmentID(attachment: MessageAttachment) {
    const raw = attachment.id ?? attachment.attachment_id ?? 'download';
    return String(raw).replace(/[^a-z0-9_-]+/gi, '') || 'download';
}

export function attachmentDownloadFilename(attachment: DownloadableAttachment, responseContentType?: string | null) {
    const fallbackExt = attachmentExtension(attachment, responseContentType);
    const originalName = attachmentOriginalName(attachment);

    if (originalName) {
        return extensionFromFilename(originalName) ? originalName : `${originalName}${fallbackExt}`;
    }

    const id = attachmentID(attachment);
    switch (attachment.file_type) {
        case 'image':
            return `image-${id}${fallbackExt}`;
        case 'video':
            return `video-${id}${fallbackExt}`;
        case 'voice':
        case 'audio':
            return `audio-${id}${fallbackExt}`;
        case 'video_note':
            return `video-note-${id}${fallbackExt}`;
        default:
            return `file-${id}${fallbackExt}`;
    }
}

export function attachmentDisplayName(attachment: DownloadableAttachment, fallback = 'file') {
    const originalName = attachmentOriginalName(attachment);
    if (originalName) {
        return originalName;
    }
    return attachmentDownloadFilename(attachment) || fallback;
}

export function attachmentDownloadURL(attachment: DownloadableAttachment) {
    if (attachment.decrypted_file_url && !attachment.decryption_error) {
        return attachment.decrypted_file_url;
    }
    if (attachment.download_url) {
        return attachment.download_url;
    }
    if (attachment.downloadUrl) {
        return attachment.downloadUrl;
    }
    if (attachment.id) {
        return joinApiURL(`/attachments/${attachment.id}/download`);
    }
    return attachment.file_url;
}

export function downloadAttachmentErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Не удалось скачать вложение';
}

export async function downloadAttachment(attachment: DownloadableAttachment) {
    const href = attachmentDownloadURL(attachment);
    if (!href) {
        throw new Error('Нет ссылки для скачивания вложения');
    }

    let response: Response;
    try {
        response = await fetch(href, { credentials: 'include' });
    } catch {
        throw new Error('Не удалось скачать вложение');
    }
    if (!response.ok) {
        throw new Error('Не удалось скачать вложение');
    }

    let blob: Blob;
    try {
        blob = await response.blob();
    } catch {
        throw new Error('Не удалось скачать вложение');
    }
    const contentType = response.headers.get('Content-Type') || blob.type;
    const blobURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobURL;
    link.download = attachmentDownloadFilename(attachment, contentType);
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);

    try {
        link.click();
    } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
    }
}
