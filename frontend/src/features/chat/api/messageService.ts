import { request } from "@/shared/api/axios.js";
import type { Conversation, Message, MessageAttachment, PinnedMessage } from "@/shared/types/domain.js";
import type { EncryptedMessagePayload } from "@/crypto/encryptMessage.js";
import type { EncryptedAttachmentFields } from "@/crypto/attachment.js";

export type PaginatedMessages = {
    messages: Message[];
    has_more: boolean;
};

type PinnedMessageResponse = {
    pinned_message: PinnedMessage | null;
};

type EncryptedForwardPayload = Partial<EncryptedMessagePayload> & {
    toUserId: number;
    attachments?: MessageAttachment[];
};

type AttachmentUploadEncryption = EncryptedAttachmentFields & {
    width?: number;
    height?: number;
};

function appendAttachmentEncryption(formData: FormData, encryption?: AttachmentUploadEncryption) {
    if (!encryption) {
        return;
    }
    formData.append('encryption_version', String(encryption.encryption_version));
    formData.append('encrypted_file_key', encryption.encrypted_file_key);
    formData.append('file_nonce', encryption.file_nonce);
    formData.append('encrypted_metadata', encryption.encrypted_metadata);
    if (encryption.width) {
        formData.append('width', String(encryption.width));
    }
    if (encryption.height) {
        formData.append('height', String(encryption.height));
    }
}

function attachmentForApi(attachment: MessageAttachment): MessageAttachment {
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
        encryption_version: attachment.encryption_version,
        encrypted_file_key: attachment.encrypted_file_key,
        file_nonce: attachment.file_nonce,
        encrypted_metadata: attachment.encrypted_metadata,
        created_at: attachment.created_at,
    };
}

export const messageService = {
    async uploadImage(file: File, encryption?: AttachmentUploadEncryption): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('image', file);
        appendAttachmentEncryption(formData, encryption);
        return request.post<MessageAttachment>('/messages/upload', formData, {
            timeout: 300000,
        });
    },
    async uploadVoice(file: File, durationSeconds: number, encryption?: EncryptedAttachmentFields): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('voice', file);
        formData.append('duration', String(durationSeconds));
        appendAttachmentEncryption(formData, encryption);
        return request.post<MessageAttachment>('/messages/upload-voice', formData, {
            timeout: 300000,
        });
    },
    async uploadVideoNote(file: File, durationSeconds: number, encryption?: EncryptedAttachmentFields): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('video_note', file);
        formData.append('duration', String(durationSeconds));
        appendAttachmentEncryption(formData, encryption);
        return request.post<MessageAttachment>('/messages/upload-video-note', formData, {
            timeout: 300000,
        });
    },
    async getConversations(): Promise<Conversation[]> {
        const conversations = await request.get<Conversation[]>('/conversations');
        return Array.isArray(conversations) ? conversations : [];
    },

    async pinConversation(conversationId: number): Promise<void> {
        await request.post(`/conversations/${conversationId}/pin`);
    },

    async unpinConversation(conversationId: number): Promise<void> {
        await request.delete(`/conversations/${conversationId}/pin`);
    },

    async getPinnedMessage(conversationId: number): Promise<PinnedMessage | null> {
        const response = await request.get<PinnedMessageResponse>(`/conversations/${conversationId}/pinned-message`);
        return response.pinned_message ?? null;
    },

    async pinMessage(conversationId: number, messageId: number): Promise<PinnedMessage> {
        const response = await request.post<PinnedMessageResponse>(`/conversations/${conversationId}/messages/${messageId}/pin`);
        if (!response.pinned_message) {
            throw new Error('Pinned message was not returned');
        }
        return response.pinned_message;
    },

    async unpinMessage(conversationId: number): Promise<void> {
        await request.delete(`/conversations/${conversationId}/pinned-message`);
    },

    async getMessagesWith(userId: string | undefined, params?: {
        before?: number;
        limit?: number
    }): Promise<PaginatedMessages> {
        const response = await request.get<PaginatedMessages>(`/messages/with/${userId}`, { params });
        return {
            messages: response.messages || [],
            has_more: response.has_more !== false,
        };
    },

    async markAsRead(userId: string | undefined): Promise<void> {
        await request.patch(`/messages/read/${userId}`);
    },

    async getUnreadCount(): Promise<number> {
        return (await request.get<{ unread_count: number }>('/messages/unread/count')).unread_count;
    },

    async sendMessage(toId: number, content: string, attachments: MessageAttachment[] = [], replyToMessageId?: number, encryption?: EncryptedMessagePayload): Promise<Message> {
        return request.post<Message>(`/messages/send/${toId}`, {
            content,
            attachments: attachments.map(attachmentForApi),
            replyToMessageId,
            ...(encryption || {}),
        });
    },

    async updateMessage(messageId: number, content: string, encryption?: EncryptedMessagePayload): Promise<Message> {
        return request.patch<Message>(`/messages/${messageId}`, {
            content,
            ...(encryption || {}),
        });
    },

    async forwardMessage(messageId: number, toUserIds: number[]): Promise<Message[]> {
        const response = await request.post<{ messages: Message[] }>(`/messages/${messageId}/forward`, {
            toUserIds,
        });
        return response.messages || [];
    },

    async forwardEncryptedMessage(messageId: number, encryptedMessages: EncryptedForwardPayload[]): Promise<Message[]> {
        const response = await request.post<{ messages: Message[] }>(`/messages/${messageId}/forward`, {
            toUserIds: encryptedMessages.map(message => message.toUserId),
            encryptedMessages: encryptedMessages.map(message => ({
                ...message,
                attachments: message.attachments?.map(attachmentForApi) || [],
            })),
        });
        return response.messages || [];
    },

    async deleteMessage(messageId: number): Promise<void> {
        await request.delete(`/messages/${messageId}`);
    },

    async deleteMessagesBatch(messageIds: number[]): Promise<void> {
        await request.delete('/messages/batch', { data: { message_ids: messageIds } });
    },

    async deleteConversationWith(userId: number): Promise<void> {
        let before: number | undefined;
        const messageIds: number[] = [];

        for (let page = 0; page < 100; page += 1) {
            const response = await this.getMessagesWith(String(userId), {
                before,
                limit: 100,
            });

            if (!response.messages.length) {
                break;
            }

            messageIds.push(...response.messages.map(message => message.id));
            before = response.messages[0]?.id;

            if (!response.has_more) {
                break;
            }
        }

        if (messageIds.length) {
            await this.deleteMessagesBatch(messageIds);
        }
    },
};
