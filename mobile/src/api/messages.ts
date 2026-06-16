import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VOICE_MAX_BYTES,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
  CHAT_VIDEO_NOTE_MAX_BYTES,
  CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS,
  CHAT_VIDEO_NOTE_MIME_TYPES,
} from '../config/env';
import { formatDuration } from '../utils/format';
import type { EncryptedAttachmentFields } from '../crypto/attachment';
import type { EncryptedMessagePayload } from '../crypto/encryptMessage';
import { apiRequest, toQueryString } from './http';
import type {
  Conversation,
  Message,
  MessageAttachment,
  PaginatedMessages,
  PinnedMessage,
} from './types';

export type LocalChatImage = {
  id: string;
  uri: string;
  type: string;
  fileName: string;
  fileSize?: number;
  width?: number;
  height?: number;
};

export type LocalVoiceMessage = {
  uri: string;
  type: string;
  fileName: string;
  durationSeconds: number;
  fileSize?: number;
};

export type LocalVideoNoteMessage = {
  uri: string;
  type: string;
  fileName: string;
  durationSeconds: number;
  fileSize?: number;
};

export type UploadFilePart =
  | {
      uri: string;
      type: string;
      fileName: string;
      fileSize?: number;
    }
  | {
      blob: Blob;
      type: string;
      fileName: string;
      fileSize?: number;
    };

type AttachmentUploadEncryption = EncryptedAttachmentFields & {
  width?: number;
  height?: number;
};

type UploadTimedFilePart = UploadFilePart & {
  durationSeconds: number;
};

type EncryptedForwardPayload = Partial<EncryptedMessagePayload> & {
  toUserId: number;
  attachments?: MessageAttachment[];
};

function appendUploadFile(
  formData: FormData,
  fieldName: string,
  file: UploadFilePart,
) {
  if ('blob' in file) {
    formData.append(fieldName, file.blob as unknown as Blob);
    return;
  }

  formData.append(fieldName, {
    uri: file.uri,
    type: file.type,
    name: file.fileName,
  } as unknown as Blob);
}

function appendAttachmentEncryption(
  formData: FormData,
  encryption?: AttachmentUploadEncryption,
) {
  if (!encryption) {
    return;
  }

  formData.append('encryption_version', String(encryption.encryption_version));
  formData.append('encrypted_file_key', encryption.encrypted_file_key);
  formData.append('file_nonce', encryption.file_nonce);
  formData.append('encrypted_metadata', encryption.encrypted_metadata);
  if (encryption.width !== undefined) {
    formData.append('width', String(encryption.width));
  }
  if (encryption.height !== undefined) {
    formData.append('height', String(encryption.height));
  }
}

export function attachmentForApi(
  attachment: MessageAttachment,
): MessageAttachment {
  return {
    id: attachment.id,
    attachment_id: attachment.attachment_id,
    message_id: attachment.message_id,
    file_url: attachment.file_url,
    file_type: attachment.file_type,
    width: attachment.width,
    height: attachment.height,
    duration: attachment.duration,
    duration_seconds: attachment.duration_seconds,
    size: attachment.size,
    original_filename: attachment.original_filename,
    content_type: attachment.content_type,
    encryption_version: attachment.encryption_version,
    encrypted_file_key: attachment.encrypted_file_key,
    file_nonce: attachment.file_nonce,
    encrypted_metadata: attachment.encrypted_metadata,
    created_at: attachment.created_at,
  };
}

export function validateLocalChatImage(image: LocalChatImage) {
  if (!(CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(image.type)) {
    return 'Поддерживаются только JPEG, PNG и WebP';
  }

  if (image.fileSize && image.fileSize > CHAT_IMAGE_MAX_BYTES) {
    return 'Изображение должно быть не больше 10 МБ';
  }

  return null;
}

export function validateLocalVoiceMessage(voice: LocalVoiceMessage) {
  if (voice.type !== CHAT_VOICE_MIME_TYPE) {
    return 'Поддерживаются только голосовые сообщения WebM';
  }

  if (voice.fileSize && voice.fileSize > CHAT_VOICE_MAX_BYTES) {
    return 'Голосовое сообщение должно быть не больше 12 МБ';
  }

  if (voice.durationSeconds < 1) {
    return 'Голосовое сообщение слишком короткое (минимум 1 секунда)';
  }

  if (voice.durationSeconds > CHAT_VOICE_MAX_DURATION_SECONDS) {
    return `Голосовое сообщение должно быть не длиннее ${formatDuration(CHAT_VOICE_MAX_DURATION_SECONDS)}`;
  }

  return null;
}

export function validateLocalVideoNoteMessage(videoNote: LocalVideoNoteMessage) {
  if (!(CHAT_VIDEO_NOTE_MIME_TYPES as readonly string[]).includes(videoNote.type)) {
    return 'Видео-сообщение должно быть в формате WebM или MP4';
  }

  if (videoNote.fileSize && videoNote.fileSize > CHAT_VIDEO_NOTE_MAX_BYTES) {
    return 'Видео-сообщение должно быть не больше 25 МБ';
  }

  if (videoNote.durationSeconds < 1) {
    return 'Видео-сообщение слишком короткое (минимум 1 секунда)';
  }

  if (videoNote.durationSeconds > CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS) {
    return `Видео-сообщение должно быть не длиннее ${formatDuration(CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS)}`;
  }

  return null;
}

function normalizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    user_id: Number(conversation.user_id),
    name: conversation.name || 'Пользователь',
    avatar: conversation.avatar ?? null,
    avatar_position_x: Number(conversation.avatar_position_x) || 50,
    avatar_position_y: Number(conversation.avatar_position_y) || 50,
    avatar_scale: Number(conversation.avatar_scale) || 1,
    last_message: conversation.last_message || '',
    last_message_at: conversation.last_message_at || '',
    last_sender_id: Number(conversation.last_sender_id) || 0,
    last_sender_name: conversation.last_sender_name || '',
    last_is_mine: Boolean(conversation.last_is_mine),
    last_read: Boolean(conversation.last_read),
    unread_count: Number(conversation.unread_count) || 0,
    is_pinned: Boolean(conversation.is_pinned),
  };
}

export const messageApi = {
  async getConversations() {
    const conversations = await apiRequest<Conversation[]>('/conversations');
    return Array.isArray(conversations)
      ? conversations.map(normalizeConversation)
      : [];
  },

  async pinConversation(conversationId: number) {
    await apiRequest<{ message: string }>(`/conversations/${conversationId}/pin`, {
      method: 'POST',
    });
  },

  async unpinConversation(conversationId: number) {
    await apiRequest<{ message: string }>(`/conversations/${conversationId}/pin`, {
      method: 'DELETE',
    });
  },

  async getMessagesWith(
    userId: number,
    params?: {
      before?: number;
      limit?: number;
    },
  ) {
    const query = params ? toQueryString(params) : '';
    const response = await apiRequest<PaginatedMessages>(
      `/messages/with/${userId}${query}`,
    );

    return {
      messages: response.messages || [],
      has_more: response.has_more !== false,
    };
  },

  async markAsRead(userId: number) {
    await apiRequest<{ message: string }>(`/messages/read/${userId}`, {
      method: 'PATCH',
    });
  },

  async getUnreadCount() {
    const response = await apiRequest<{ unread_count: number }>(
      '/messages/unread/count',
    );
    return response.unread_count;
  },

  async uploadImage(
    image: LocalChatImage | UploadFilePart,
    encryption?: AttachmentUploadEncryption,
  ) {
    const formData = new FormData();
    appendUploadFile(formData, 'image', image);
    appendAttachmentEncryption(formData, encryption);

    return apiRequest<MessageAttachment>('/messages/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async uploadVoice(
    voice: LocalVoiceMessage | UploadTimedFilePart,
    encryption?: EncryptedAttachmentFields,
  ) {
    const formData = new FormData();
    appendUploadFile(formData, 'voice', voice);
    formData.append('duration', String(voice.durationSeconds));
    appendAttachmentEncryption(formData, encryption);

    return apiRequest<MessageAttachment>('/messages/upload-voice', {
      method: 'POST',
      body: formData,
    });
  },

  async uploadVideoNote(
    videoNote: LocalVideoNoteMessage | UploadTimedFilePart,
    encryption?: EncryptedAttachmentFields,
  ) {
    const formData = new FormData();
    appendUploadFile(formData, 'video_note', videoNote);
    formData.append('duration', String(videoNote.durationSeconds));
    appendAttachmentEncryption(formData, encryption);

    return apiRequest<MessageAttachment>('/messages/upload-video-note', {
      method: 'POST',
      body: formData,
    });
  },

  async sendMessage(
    toId: number,
    content: string,
    attachments: MessageAttachment[] = [],
    replyToMessageId?: number | null,
    encryption?: EncryptedMessagePayload,
  ) {
    return apiRequest<Message>(`/messages/send/${toId}`, {
      method: 'POST',
      body: {
        content,
        attachments: attachments.map(attachmentForApi),
        replyToMessageId: replyToMessageId ?? null,
        ...(encryption || {}),
      },
    });
  },

  async forwardMessage(messageId: number, toUserIds: number[]) {
    const response = await apiRequest<{ messages: Message[] }>(
      `/messages/${messageId}/forward`,
      {
        method: 'POST',
        body: { toUserIds },
      },
    );
    return response.messages || [];
  },

  async forwardEncryptedMessage(
    messageId: number,
    encryptedMessages: EncryptedForwardPayload[],
  ) {
    const response = await apiRequest<{ messages: Message[] }>(
      `/messages/${messageId}/forward`,
      {
        method: 'POST',
        body: {
          toUserIds: encryptedMessages.map(message => message.toUserId),
          encryptedMessages: encryptedMessages.map(message => ({
            ...message,
            attachments: message.attachments?.map(attachmentForApi) || [],
          })),
        },
      },
    );
    return response.messages || [];
  },

  async getPinnedMessage(conversationId: number) {
    const response = await apiRequest<{ pinned_message: PinnedMessage | null }>(
      `/conversations/${conversationId}/pinned-message`,
    );
    return response.pinned_message ?? null;
  },

  async pinMessage(conversationId: number, messageId: number) {
    const response = await apiRequest<{ pinned_message: PinnedMessage | null }>(
      `/conversations/${conversationId}/messages/${messageId}/pin`,
      { method: 'POST' },
    );
    if (!response.pinned_message) {
      throw new Error('Pinned message was not returned');
    }
    return response.pinned_message;
  },

  async unpinMessage(conversationId: number) {
    await apiRequest<{ message: string }>(
      `/conversations/${conversationId}/pinned-message`,
      { method: 'DELETE' },
    );
  },

  async updateMessage(
    messageId: number,
    content: string,
    encryption?: EncryptedMessagePayload,
  ) {
    return apiRequest<Message>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: {
        content,
        ...(encryption || {}),
      },
    });
  },

  async deleteMessage(messageId: number) {
    await apiRequest<{ message: string }>(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  },

  async deleteMessagesBatch(messageIds: number[]) {
    await apiRequest<{ message: string }>('/messages/batch', {
      method: 'DELETE',
      body: { message_ids: messageIds },
    });
  },

  async deleteConversationWith(userId: number) {
    let before: number | undefined;
    const messageIds: number[] = [];

    for (let page = 0; page < 100; page += 1) {
      const response = await this.getMessagesWith(userId, {
        before,
        limit: 100,
      });

      if (response.messages.length === 0) {
        break;
      }

      messageIds.push(...response.messages.map(message => message.id));
      before = response.messages[0]?.id;

      if (!response.has_more) {
        break;
      }
    }

    if (messageIds.length > 0) {
      await this.deleteMessagesBatch(messageIds);
    }
  },
};
