export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_COUNT = 5;
export const CHAT_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const CHAT_VOICE_MAX_BYTES = 12 * 1024 * 1024;
export const CHAT_VOICE_MAX_DURATION_SECONDS = 5 * 60;
export const CHAT_VOICE_MIME_TYPE = 'audio/webm';

export const CHAT_VIDEO_NOTE_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS = 60;
export const CHAT_VIDEO_NOTE_MIME_TYPES = ['video/webm', 'video/mp4'] as const;

export const chatImageMaxSize = CHAT_IMAGE_MAX_BYTES;
export const chatImageMaxCount = CHAT_IMAGE_MAX_COUNT;
export const chatVoiceMaxSize = CHAT_VOICE_MAX_BYTES;
export const chatVoiceMaxDurationSeconds = CHAT_VOICE_MAX_DURATION_SECONDS;
export const chatVideoNoteMaxSize = CHAT_VIDEO_NOTE_MAX_BYTES;
export const chatVideoNoteMaxDurationSeconds =
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS;

export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(
      bytes % (1024 * 1024) === 0 ? 0 : 1,
    )} МБ`;
  }

  if (bytes >= 1024) {
    return `${Math.ceil(bytes / 1024)} КБ`;
  }

  return `${bytes} Б`;
}

export function formatDuration(totalSeconds?: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
