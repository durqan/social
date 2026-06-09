import type { Message } from '../../../api/types';
import { decryptAttachmentForDisplay, isEncryptedAttachment } from '../../../crypto/attachment';
import { decryptMessage, isEncryptedMessage } from '../../../crypto/decryptMessage';
import type { LocalE2EEKeyBundle } from '../../../crypto/masterKey';

export const decryptFailureText = 'Не удалось расшифровать сообщение';
export const decryptAttachmentFailureText = 'Не удалось расшифровать вложение';

export async function decryptMessagesForDisplay(
  messages: Message[],
  currentUserId?: number,
  bundle?: LocalE2EEKeyBundle | null,
): Promise<Message[]> {
  if (!currentUserId || !bundle) {
    return messages.map(message => markEncryptedUnreadable(message));
  }

  return Promise.all(
    messages.map(message => decryptMessageForDisplay(message, currentUserId, bundle)),
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
        try {
          return await decryptAttachmentForDisplay(next, attachment, currentUserId, bundle);
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

  try {
    return {
      ...next,
      content: await decryptMessage(next, currentUserId, bundle),
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
    next.forwarded_from_message = markEncryptedUnreadable(next.forwarded_from_message);
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
