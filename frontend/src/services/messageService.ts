import api from '../api/axios.js';
import type { Conversation, Message, MessageAttachment } from '../types.js';

export type PaginatedMessages = {
    messages: Message[];
    has_more: boolean;
};

export const messageService = {
    async uploadImage(file: File): Promise<MessageAttachment> {
        const formData = new FormData();
        formData.append('image', file);
        const response = await api.post('/messages/upload', formData);
        return response.data;
    },
    async getConversations(): Promise<Conversation[]> {
        const response = await api.get('/messages/conversations');
        return Array.isArray(response.data) ? response.data : [];
    },

    async getMessagesWith(userId: string | undefined, params?: {
        before?: number;
        limit?: number
    }): Promise<PaginatedMessages> {
        const response = await api.get(`/messages/with/${userId}`, { params });
        return {
            messages: response.data.messages || [],
            has_more: response.data.has_more !== false,
        };
    },

    async markAsRead(userId: string | undefined): Promise<void> {
        await api.patch(`/messages/read/${userId}`);
    },

    async getUnreadCount(): Promise<number> {
        const response = await api.get('/messages/unread/count');
        return response.data.unread_count;
    },

    async updateMessage(messageId: number, content: string): Promise<Message> {
        const response = await api.patch(`/messages/${messageId}`, { content });
        return response.data;
    },

    async deleteMessage(messageId: number): Promise<void> {
        await api.delete(`/messages/${messageId}`);
    },

    async deleteMessagesBatch(messageIds: number[]): Promise<void> {
        await api.delete('/messages/batch', { data: { message_ids: messageIds } });
    },
};
