import type { Message } from '../../../api/types';

const TEMP_MESSAGE_ID_THRESHOLD = 10000000;
const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function cleanUrl(value: string) {
  return value.replace(/[),.!?;:]+$/, '');
}

function normalizeUrl(value: string) {
  return value.startsWith('www.') ? `https://${value}` : value;
}

export function firstUrl(value: string) {
  const match = value.match(urlPattern)?.[0];
  return match ? normalizeUrl(cleanUrl(match)) : '';
}

export function formatBytes(bytes?: number) {
  const safeBytes = Math.max(0, bytes || 0);
  if (safeBytes >= 1024 * 1024) {
    return `${(safeBytes / (1024 * 1024)).toFixed(
      safeBytes % (1024 * 1024) === 0 ? 0 : 1,
    )} МБ`;
  }
  if (safeBytes >= 1024) {
    return `${Math.ceil(safeBytes / 1024)} КБ`;
  }
  return `${safeBytes} Б`;
}

export function isPersistedMessage(message: Message) {
  return message.id > 0 && message.id < TEMP_MESSAGE_ID_THRESHOLD;
}

export function messageAuthorName(message?: Message | null) {
  if (!message) {
    return 'Сообщение';
  }
  return message.from?.name || 'Пользователь';
}

export function messagePreviewText(message?: Message | null) {
  if (!message) {
    return 'Сообщение недоступно';
  }
  if (message.decryption_error) {
    return 'Не удалось расшифровать сообщение';
  }
  const content = message.content?.trim();
  if (content) {
    return content.length > 80 ? `${content.slice(0, 77)}...` : content;
  }
  if ((message.encryption_version ?? 0) > 0) {
    return 'Зашифрованное сообщение';
  }
  if (message.attachments?.some(attachment => attachment.decryption_error)) {
    return 'Не удалось расшифровать вложение';
  }
  const attachment = message.attachments?.[0];
  if (!attachment) {
    return 'Сообщение недоступно';
  }
  if (attachment.file_type === 'voice') {
    return 'Голосовое сообщение';
  }
  if (attachment.file_type === 'video_note') {
    return 'Видео-сообщение';
  }
  if (attachment.file_type === 'video') {
    return 'Видео';
  }
  if (attachment.file_type === 'audio') {
    return 'Аудио';
  }
  if (attachment.file_type === 'file') {
    return 'Файл';
  }
  return 'Вложение';
}

export function linkParts(value: string) {
  const parts: Array<{ type: 'text' | 'link'; value: string; href?: string }> =
    [];
  let lastIndex = 0;

  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;
    const cleanedUrl = cleanUrl(rawUrl);

    if (index > lastIndex) {
      parts.push({ type: 'text', value: value.slice(lastIndex, index) });
    }

    parts.push({
      type: 'link',
      value: cleanedUrl,
      href: normalizeUrl(cleanedUrl),
    });

    if (cleanedUrl.length < rawUrl.length) {
      parts.push({ type: 'text', value: rawUrl.slice(cleanedUrl.length) });
    }

    lastIndex = index + rawUrl.length;
  }

  if (lastIndex < value.length) {
    parts.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return parts;
}

export function linkPreviewProviderLabel(provider?: string) {
  if (provider === 'youtube') {
    return 'YouTube';
  }
  if (provider === 'rutube') {
    return 'RuTube';
  }
  if (provider === 'tiktok') {
    return 'TikTok';
  }
  return 'Видео';
}

export function linkPreviewDomain(raw: string) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}
