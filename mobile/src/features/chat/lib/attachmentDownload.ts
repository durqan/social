import { NativeModules, Platform } from 'react-native';

import type { MessageAttachment } from '../../../api/types';
import { assetURL } from '../../../config/env';
import { getCookieHeader } from '../../../api/http';
import { bytesToBase64, utf8ToBytes } from '../../../crypto/encoding';

type AttachmentDownloadNativeModule = {
  downloadHttp: (
    url: string,
    fileName: string,
    mimeType: string,
    cookieHeader: string,
  ) => Promise<number>;
  saveBase64File: (
    base64: string,
    fileName: string,
    mimeType: string,
  ) => Promise<string>;
};

type DownloadResult = {
  fileName: string;
  status: 'queued' | 'saved';
};

const nativeDownload = NativeModules.AttachmentDownload as
  | AttachmentDownloadNativeModule
  | undefined;

export function isAttachmentDownloadable(attachment: MessageAttachment) {
  if (attachment.decryption_error) {
    return false;
  }
  if (
    (attachment.encryption_version ?? 0) > 0 &&
    !attachment.decrypted_file_url
  ) {
    return false;
  }
  return Boolean(attachment.decrypted_file_url || attachment.file_url);
}

export function attachmentDownloadUrl(attachment: MessageAttachment) {
  return attachment.decrypted_file_url || assetURL(attachment.file_url);
}

export async function downloadChatAttachment(
  attachment: MessageAttachment,
  sourceUrl = attachmentDownloadUrl(attachment),
): Promise<DownloadResult> {
  const downloadModule = getNativeDownloadModule();
  const mimeType = attachmentMimeType(attachment);
  const fileName = attachmentFileName(attachment, mimeType);

  if (sourceUrl.startsWith('data:')) {
    const data = dataUriToBase64(sourceUrl);
    await downloadModule.saveBase64File(
      data.base64,
      fileName,
      data.mimeType || mimeType,
    );
    return { fileName, status: 'saved' };
  }

  if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
    await downloadModule.downloadHttp(
      sourceUrl,
      fileName,
      mimeType,
      await getCookieHeader(),
    );
    return { fileName, status: 'queued' };
  }

  if (sourceUrl.startsWith('file://') || sourceUrl.startsWith('content://')) {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error('local attachment read failed');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await downloadModule.saveBase64File(
      bytesToBase64(bytes),
      fileName,
      mimeType,
    );
    return { fileName, status: 'saved' };
  }

  throw new Error('unsupported attachment source');
}

export function downloadAttachmentErrorMessage(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';

  if (code === 'E_DOWNLOAD_PERMISSION') {
    return 'Разрешите доступ к хранилищу, чтобы сохранить файл.';
  }
  if (code === 'E_DOWNLOAD_UNAVAILABLE') {
    return 'Скачивание файлов доступно только в Android-приложении.';
  }
  return 'Не удалось скачать файл. Попробуйте позже.';
}

function getNativeDownloadModule() {
  if (Platform.OS !== 'android' || !nativeDownload) {
    const error = new Error('attachment download unavailable') as Error & {
      code?: string;
    };
    error.code = 'E_DOWNLOAD_UNAVAILABLE';
    throw error;
  }
  return nativeDownload;
}

function dataUriToBase64(uri: string) {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    throw new Error('invalid data uri');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const encoded = decodeURIComponent(match[3] || '');
  if (match[2]) {
    return { base64: encoded, mimeType };
  }
  return { base64: bytesToBase64(utf8ToBytes(encoded)), mimeType };
}

function attachmentMimeType(attachment: MessageAttachment) {
  return (
    attachment.original_mime_type ||
    attachment.content_type ||
    fallbackMimeType(attachment.file_type)
  );
}

function attachmentFileName(attachment: MessageAttachment, mimeType: string) {
  const original = sanitizeFileName(attachment.original_filename);
  if (original) {
    return ensureFileExtension(original, mimeType);
  }

  const suffix = attachment.id || attachment.attachment_id || Date.now();
  return `${defaultBaseName(attachment.file_type)}-${suffix}.${extensionForMimeType(
    mimeType,
    attachment.file_type,
  )}`;
}

function sanitizeFileName(fileName?: string) {
  const trimmed = fileName
    ?.split(/[\\/]/)
    .pop()
    ?.split('')
    .map(char => (isUnsafeFileNameChar(char) ? '_' : char))
    .join('')
    .trim();
  return trimmed || null;
}

function isUnsafeFileNameChar(char: string) {
  const code = char.charCodeAt(0);
  return code < 32 || ':*?"<>|'.includes(char);
}

function ensureFileExtension(fileName: string, mimeType: string) {
  if (/\.[a-z0-9]{1,8}$/i.test(fileName)) {
    return fileName;
  }
  return `${fileName}.${extensionForMimeType(mimeType, 'file')}`;
}

function defaultBaseName(fileType: MessageAttachment['file_type']) {
  switch (fileType) {
    case 'image':
      return 'chat-image';
    case 'voice':
      return 'voice-message';
    case 'video_note':
      return 'video-message';
    case 'video':
      return 'chat-video';
    case 'audio':
      return 'chat-audio';
    default:
      return 'chat-file';
  }
}

function fallbackMimeType(fileType: MessageAttachment['file_type']) {
  switch (fileType) {
    case 'image':
      return 'image/jpeg';
    case 'voice':
      return 'audio/webm';
    case 'video_note':
      return 'video/webm';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    default:
      return 'application/octet-stream';
  }
}

function extensionForMimeType(
  mimeType: string,
  fileType: MessageAttachment['file_type'],
) {
  const normalized = mimeType.toLowerCase().split(';')[0].trim();
  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
    case 'application/ogg':
      return 'ogg';
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'application/pdf':
      return 'pdf';
    case 'text/plain':
      return 'txt';
    default:
      return fileType === 'file'
        ? 'bin'
        : fallbackMimeType(fileType).split('/')[1];
  }
}
