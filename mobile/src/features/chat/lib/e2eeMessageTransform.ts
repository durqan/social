import type { Message } from '../../../api/types';
import {
  decryptAttachmentForDisplay,
  isEncryptedAttachment,
} from '../../../crypto/attachment';
import {
  decryptMessage,
  isEncryptedMessage,
} from '../../../crypto/decryptMessage';
import type { LocalE2EEKeyBundle } from '../../../crypto/masterKey';

const decryptFailureText = 'Не удалось расшифровать сообщение';
const maxMessageContentCacheEntries = 500;
const maxAttachmentCacheEntries = 48;
const maxAttachmentCacheBytes = 48 * 1024 * 1024;

type MessageContentCacheEntry = {
  content: string;
};

type AttachmentDisplayCacheEntry = {
  decrypted_file_url?: string;
  original_mime_type?: string;
  original_filename?: string;
  original_size?: number;
  width?: number;
  height?: number;
  duration?: number;
  duration_seconds?: number;
  byteSize: number;
};

const messageContentCache = new Map<string, MessageContentCacheEntry>();
const attachmentDisplayCache = new Map<string, AttachmentDisplayCacheEntry>();
let attachmentCacheBytes = 0;

export async function decryptMessagesForDisplay(
  messages: Message[],
  currentUserId?: number,
  bundle?: LocalE2EEKeyBundle | null,
): Promise<Message[]> {
  if (!currentUserId || !bundle) {
    return messages.map(message => markEncryptedUnreadable(message));
  }

  return Promise.all(
    messages.map(message =>
      decryptMessageForDisplay(message, currentUserId, bundle),
    ),
  );
}

export async function decryptMessageForDisplay(
  message: Message,
  currentUserId: number,
  bundle: LocalE2EEKeyBundle,
): Promise<Message> {
  const next: Message = { ...message };

  if (next.reply_to_message) {
    next.reply_to_message = await decryptMessageForDisplay(
      next.reply_to_message,
      currentUserId,
      bundle,
    );
  }
  if (next.forwarded_from_message) {
    next.forwarded_from_message = await decryptMessageForDisplay(
      next.forwarded_from_message,
      currentUserId,
      bundle,
    );
  }
  if (next.attachments?.length) {
    next.attachments = await Promise.all(
      next.attachments.map(async attachment => {
        if (!isEncryptedAttachment(attachment)) {
          return attachment;
        }
        const cacheKey = attachmentCacheKey(next, attachment, currentUserId);
        const cached = getCachedAttachment(cacheKey);
        if (cached) {
          return {
            ...attachment,
            decrypted_file_url: cached.decrypted_file_url,
            original_mime_type: cached.original_mime_type,
            original_filename: cached.original_filename,
            original_size: cached.original_size,
            width: attachment.width ?? cached.width,
            height: attachment.height ?? cached.height,
            duration: attachment.duration ?? cached.duration,
            duration_seconds:
              attachment.duration_seconds ?? cached.duration_seconds,
            decryption_error: false,
          };
        }
        try {
          const decrypted = await decryptAttachmentForDisplay(
            next,
            attachment,
            currentUserId,
            bundle,
          );
          setCachedAttachment(cacheKey, attachmentCacheEntry(decrypted));
          return decrypted;
        } catch {
          return {
            ...attachment,
            decryption_error: true,
          };
        }
      }),
    );
  }

  if (!isEncryptedMessage(next)) {
    return next;
  }
  if (next.content && !next.decryption_error) {
    return next;
  }

  const cacheKey = messageContentCacheKey(next, currentUserId);
  const cached = getCachedMessageContent(cacheKey);
  if (cached) {
    return {
      ...next,
      content: cached.content,
      decryption_error: false,
    };
  }

  try {
    const content = await decryptMessage(next, currentUserId, bundle);
    setCachedMessageContent(cacheKey, { content });
    return {
      ...next,
      content,
      decryption_error: false,
    };
  } catch {
    return {
      ...next,
      content: decryptFailureText,
      decryption_error: true,
    };
  }
}

function markEncryptedUnreadable(message: Message): Message {
  const next: Message = { ...message };
  if (next.reply_to_message) {
    next.reply_to_message = markEncryptedUnreadable(next.reply_to_message);
  }
  if (next.forwarded_from_message) {
    next.forwarded_from_message = markEncryptedUnreadable(
      next.forwarded_from_message,
    );
  }
  if (next.attachments?.length) {
    next.attachments = next.attachments.map(attachment =>
      isEncryptedAttachment(attachment)
        ? { ...attachment, decryption_error: true }
        : attachment,
    );
  }
  if (isEncryptedMessage(next) && !next.content) {
    next.content = decryptFailureText;
    next.decryption_error = true;
  }
  return next;
}

export function clearE2EEMessageDisplayCache() {
  messageContentCache.clear();
  attachmentDisplayCache.clear();
  attachmentCacheBytes = 0;
}

function getCachedMessageContent(key: string) {
  const cached = messageContentCache.get(key);
  if (cached) {
    messageContentCache.delete(key);
    messageContentCache.set(key, cached);
  }
  return cached;
}

function setCachedMessageContent(key: string, entry: MessageContentCacheEntry) {
  messageContentCache.delete(key);
  messageContentCache.set(key, entry);
  trimMap(messageContentCache, maxMessageContentCacheEntries);
}

function getCachedAttachment(key: string) {
  const cached = attachmentDisplayCache.get(key);
  if (cached) {
    attachmentDisplayCache.delete(key);
    attachmentDisplayCache.set(key, cached);
  }
  return cached;
}

function setCachedAttachment(key: string, entry: AttachmentDisplayCacheEntry) {
  const previous = attachmentDisplayCache.get(key);
  if (previous) {
    attachmentCacheBytes -= previous.byteSize;
    attachmentDisplayCache.delete(key);
  }

  if (entry.byteSize > maxAttachmentCacheBytes) {
    return;
  }

  attachmentDisplayCache.set(key, entry);
  attachmentCacheBytes += entry.byteSize;
  trimAttachmentCache();
}

function trimMap<K, V>(map: Map<K, V>, maxEntries: number) {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
  }
}

function trimAttachmentCache() {
  while (
    attachmentDisplayCache.size > maxAttachmentCacheEntries ||
    attachmentCacheBytes > maxAttachmentCacheBytes
  ) {
    const oldestKey = attachmentDisplayCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = attachmentDisplayCache.get(oldestKey);
    if (oldest) {
      attachmentCacheBytes -= oldest.byteSize;
    }
    attachmentDisplayCache.delete(oldestKey);
  }
}

function messageContentCacheKey(message: Message, currentUserId: number) {
  return [
    currentUserId,
    message.id,
    message.from_id,
    message.to_id,
    message.encryption_version ?? 0,
    message.nonce || '',
    message.ciphertext || '',
  ].join(':');
}

function attachmentCacheKey(
  message: Message,
  attachment: NonNullable<Message['attachments']>[number],
  currentUserId: number,
) {
  return [
    currentUserId,
    message.from_id,
    message.to_id,
    attachment.id ?? '',
    attachment.attachment_id ?? '',
    attachment.file_url,
    attachment.file_type,
    attachment.encryption_version ?? 0,
    attachment.encrypted_file_key || '',
    attachment.file_nonce || '',
    attachment.encrypted_metadata || '',
  ].join(':');
}

function attachmentCacheEntry(
  attachment: NonNullable<Message['attachments']>[number],
): AttachmentDisplayCacheEntry {
  return {
    decrypted_file_url: attachment.decrypted_file_url,
    original_mime_type: attachment.original_mime_type,
    original_filename: attachment.original_filename,
    original_size: attachment.original_size,
    width: attachment.width,
    height: attachment.height,
    duration: attachment.duration,
    duration_seconds: attachment.duration_seconds,
    byteSize: cachedAttachmentByteSize(attachment),
  };
}

function cachedAttachmentByteSize(
  attachment: NonNullable<Message['attachments']>[number],
) {
  return (
    attachment.original_size ||
    attachment.size ||
    attachment.decrypted_file_url?.length ||
    0
  );
}
