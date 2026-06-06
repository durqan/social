import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MIME_TYPES,
  CHAT_VOICE_MAX_BYTES,
  CHAT_VOICE_MAX_DURATION_SECONDS,
  CHAT_VOICE_MIME_TYPE,
} from '../config/env';
import { formatDuration } from '../utils/format';
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
};

export type LocalVoiceMessage = {
  uri: string;
  type: string;
  fileName: string;
  durationSeconds: number;
  fileSize?: number;
};

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

function normalizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    user_id: Number(conversation.user_id),
    name: conversation.name || 'Пользователь',
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
    const conversations = await apiRequest<Conversation[]>(
      '/messages/conversations',
    );
    return Array.isArray(conversations)
      ? conversations.map(normalizeConversation)
      : [];
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

  async uploadImage(image: LocalChatImage) {
    const formData = new FormData();
    formData.append('image', {
      uri: image.uri,
      type: image.type,
      name: image.fileName,
    } as unknown as Blob);

    return apiRequest<MessageAttachment>('/messages/upload', {
      method: 'POST',
      body: formData,
    });
  },

  async uploadVoice(voice: LocalVoiceMessage) {
    const formData = new FormData();
    formData.append('voice', {
      uri: voice.uri,
      type: voice.type,
      name: voice.fileName,
    } as unknown as Blob);
    formData.append('duration', String(voice.durationSeconds));

    return apiRequest<MessageAttachment>('/messages/upload-voice', {
      method: 'POST',
      body: formData,
    });
  },

  async sendMessage(
    toId: number,
    content: string,
    attachments: MessageAttachment[] = [],
    replyToMessageId?: number | null,
  ) {
    return apiRequest<Message>(`/messages/send/${toId}`, {
      method: 'POST',
      body: {
        content,
        attachments,
        reply_to_message_id: replyToMessageId ?? null,
      },
    });
  },

  async forwardMessage(messageId: number, toUserIds: number[]) {
    const response = await apiRequest<{ messages: Message[] }>(
      `/messages/${messageId}/forward`,
      {
        method: 'POST',
        body: { to_user_ids: toUserIds },
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

  async updateMessage(messageId: number, content: string) {
    return apiRequest<Message>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: {
        content,
      },
    });
  },

  async deleteMessage(messageId: number) {
    await apiRequest<{ message: string }>(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  },
};
