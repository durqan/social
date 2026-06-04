import { request } from "@/shared/api/axios.js";
import type { Conversation, Message, MessageAttachment } from "@/shared/types/domain.js";

export type PaginatedMessages = {
    messages: Message[];
    has_more: boolean;
};

export const messageService = {
    async uploadImage(file: File): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('image', file);
        return request.post<MessageAttachment>('/messages/upload', formData, {
            timeout: 300000,
        });
    },
    async uploadVoice(file: File, durationSeconds: number): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('voice', file);
        formData.append('duration', String(durationSeconds));
        return request.post<MessageAttachment>('/messages/upload-voice', formData, {
            timeout: 300000,
        });
    },
    async uploadVideoNote(file: File, durationSeconds: number): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('video_note', file);
        formData.append('duration', String(durationSeconds));
        return request.post<MessageAttachment>('/messages/upload-video-note', formData, {
            timeout: 300000,
        });
    },
    async getConversations(): Promise<Conversation[]> {
        const conversations = await request.get<Conversation[]>('/messages/conversations');
        return Array.isArray(conversations) ? conversations : [];
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

    async updateMessage(messageId: number, content: string): Promise<Message> {
        return request.patch<Message>(`/messages/${messageId}`, { content });
    },

    async forwardMessage(messageId: number, toUserIds: number[]): Promise<Message[]> {
        const response = await request.post<{ messages: Message[] }>(`/messages/${messageId}/forward`, {
            toUserIds,
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
