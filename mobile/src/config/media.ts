export const AVATAR_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_COUNT = 5;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const CHAT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export const CHAT_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const CHAT_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
export const CHAT_AUDIO_MAX_BYTES = 100 * 1024 * 1024;
export const CHAT_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'application/ogg',
  'audio/webm',
] as const;
export const CHAT_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const CHAT_FILE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'text/csv',
  'application/csv',
] as const;
export const CHAT_BLOCKED_ATTACHMENT_EXTENSIONS = [
  'exe',
  'apk',
  'bat',
  'cmd',
  'sh',
  'js',
  'mjs',
  'cjs',
  'php',
  'py',
  'jar',
  'dmg',
  'deb',
  'rpm',
  'msi',
  'html',
  'htm',
  'svg',
] as const;

export const CHAT_VOICE_MAX_BYTES = 100 * 1024 * 1024;
export const CHAT_VOICE_MAX_DURATION_SECONDS = 5 * 60;
export const CHAT_VOICE_MIME_TYPE = 'audio/webm';

export const CHAT_VIDEO_NOTE_MAX_BYTES = 100 * 1024 * 1024;
export const CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS = 5 * 60;
export const CHAT_VIDEO_NOTE_MIME_TYPES = ['video/webm', 'video/mp4'] as const;
