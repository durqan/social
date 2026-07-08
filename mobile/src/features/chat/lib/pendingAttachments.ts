import type { DocumentPickerResponse } from '@react-native-documents/picker';
import type { Asset } from 'react-native-image-picker';
import {
  CHAT_AUDIO_MIME_TYPES,
  CHAT_FILE_MIME_TYPES,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VIDEO_MIME_TYPES,
  formatFileSize,
} from '@social/shared';

import type {
  ChatUploadAttachmentType,
  LocalVideoNoteMessage,
} from '../../../api/messages';
import type { LocalAttachmentSource } from '../../../crypto/attachment';
import { formatDuration } from '../../../utils/format';

export type PendingChatAttachment = LocalAttachmentSource & {
  id: string;
  fileType: ChatUploadAttachmentType;
};

export function assetToPendingAttachment(
  asset: Asset,
): PendingChatAttachment | null {
  if (!asset.uri) {
    return null;
  }

  const fileName =
    asset.fileName || defaultAttachmentFileName(asset.type, Date.now());
  const type = normalizeAttachmentMimeType(asset.type, fileName);
  if (!type) {
    return null;
  }

  const fileType = attachmentFileTypeFromMime(type);
  if (fileType !== 'image' && fileType !== 'video') {
    return null;
  }

  return {
    id: localAttachmentId(asset.uri, asset.fileSize),
    uri: asset.uri,
    type,
    fileName,
    fileSize: asset.fileSize,
    width: asset.width,
    height: asset.height,
    durationSeconds:
      fileType === 'video' && asset.duration
        ? Math.max(1, Math.round(asset.duration))
        : undefined,
    fileType,
  };
}

export function documentToPendingAttachment(
  document: DocumentPickerResponse,
): PendingChatAttachment | null {
  if (!document.uri) {
    return null;
  }

  const fileName = document.name?.trim() || `attachment-${Date.now()}`;
  const type = normalizeAttachmentMimeType(document.type, fileName);
  if (!type) {
    return null;
  }

  return {
    id: localAttachmentId(document.uri, document.size ?? undefined),
    uri: document.uri,
    type,
    fileName,
    fileSize: document.size ?? undefined,
    fileType: attachmentFileTypeFromMime(type),
  };
}

export function assetToLocalVideoNote(
  asset?: Asset,
): LocalVideoNoteMessage | null {
  if (!asset?.uri) {
    return null;
  }

  const durationSeconds = Math.max(
    1,
    Math.round(asset.duration ?? CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS),
  );

  return {
    uri: asset.uri,
    type: asset.type || 'video/mp4',
    fileName: asset.fileName || `video-note-${Date.now()}.mp4`,
    durationSeconds,
    fileSize: asset.fileSize,
  };
}

export function pendingAttachmentSubtitle(attachment: PendingChatAttachment) {
  const parts = [pendingAttachmentTypeLabel(attachment.fileType)];
  if (attachment.durationSeconds) {
    parts.push(formatDuration(attachment.durationSeconds));
  }
  if (attachment.fileSize) {
    parts.push(formatFileSize(attachment.fileSize));
  }
  return parts.join(' · ');
}

export function extensionFromFileName(fileName: string) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() || '';
}

function pendingAttachmentTypeLabel(fileType: ChatUploadAttachmentType) {
  switch (fileType) {
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

function localAttachmentId(uri: string, fileSize?: number | null) {
  return `${uri}-${fileSize ?? Date.now()}`;
}

function normalizeAttachmentMimeType(
  mimeType?: string | null,
  fileName?: string,
) {
  const raw = mimeType?.split(';')[0]?.trim().toLowerCase() || '';
  const inferred = inferMimeTypeFromFileName(fileName);

  if (!raw || raw === 'application/octet-stream' || !raw.includes('/')) {
    return inferred || raw || '';
  }

  switch (raw) {
    case 'image/jpg':
      return 'image/jpeg';
    case 'audio/m4a':
      return 'audio/mp4';
    case 'text/comma-separated-values':
      return 'text/csv';
    default:
      return raw;
  }
}

function inferMimeTypeFromFileName(fileName?: string) {
  switch (extensionFromFileName(fileName || '')) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'pdf':
      return 'application/pdf';
    case 'txt':
      return 'text/plain';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'zip':
      return 'application/zip';
    case 'json':
      return 'application/json';
    case 'csv':
      return 'text/csv';
    default:
      return '';
  }
}

function attachmentFileTypeFromMime(type: string): ChatUploadAttachmentType {
  if (
    type.startsWith('image/') ||
    (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(type)
  ) {
    return 'image';
  }
  if (
    type.startsWith('video/') ||
    (CHAT_VIDEO_MIME_TYPES as readonly string[]).includes(type)
  ) {
    return 'video';
  }
  if (
    type.startsWith('audio/') ||
    (CHAT_AUDIO_MIME_TYPES as readonly string[]).includes(type)
  ) {
    return 'audio';
  }
  if ((CHAT_FILE_MIME_TYPES as readonly string[]).includes(type)) {
    return 'file';
  }
  return 'file';
}

function defaultAttachmentFileName(type: string | undefined, timestamp: number) {
  const normalizedType = normalizeAttachmentMimeType(type);
  const fileType = normalizedType
    ? attachmentFileTypeFromMime(normalizedType)
    : 'file';

  switch (fileType) {
    case 'image':
      return `chat-image-${timestamp}.jpg`;
    case 'video':
      return `chat-video-${timestamp}.mp4`;
    case 'audio':
      return `chat-audio-${timestamp}.mp3`;
    default:
      return `attachment-${timestamp}`;
  }
}
