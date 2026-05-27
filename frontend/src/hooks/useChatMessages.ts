import { useState, useCallback } from 'react';
import { messageService } from '../services/messageService.js';
import type { Message } from '../types.js';

const dispatchUnreadReset = () => {
    window.dispatchEvent(new Event('reset-unread'));
};

export const useChatMessages = (userId: string | undefined, currentUserId: number | undefined) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
    const [editContent, setEditContent] = useState('');

    const loadInitial = useCallback(async () => {
        if (!userId) return;
        setInitialLoading(true);
        try {
            const res = await messageService.getMessagesWith(userId, {limit: 20});
            const otherUserID = Number(userId);
            setMessages(res.messages.map(message =>
                message.from_id === otherUserID ? { ...message, is_read: true } : message
            ));
            setHasMore(res.has_more);
            dispatchUnreadReset();
        } catch (error) {
            console.error(error);
        } finally {
            setInitialLoading(false);
        }
    }, [userId]);

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore || messages.length === 0) return;
        setLoadingMore(true);
        const oldestId = messages[0]?.id;
        try {
            const res = await messageService.getMessagesWith(userId, { before: oldestId, limit: 20 });
            const newMessages = res.messages;
            setHasMore(res.has_more);
            if (newMessages.length) {
                setMessages(prev => [...newMessages, ...prev]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, hasMore, messages, userId]);

    const sendMessage = useCallback((content: string, tempMessage: Message) => {
        setMessages(prev => [...prev, tempMessage]);
        return tempMessage;
    }, []);

    const updateMessage = useCallback(async (messageId: number, newContent: string) => {
        const updated = await messageService.updateMessage(messageId, newContent);
        setMessages(prev => prev.map(m => m.id === messageId ? updated : m));
    }, []);

    const deleteMessage = useCallback(async (messageId: number) => {
        if (messageId > 0 && messageId < 10000000) {
            await messageService.deleteMessage(messageId);
        }
        setMessages(prev => prev.filter(m => m.id !== messageId));
    }, []);

    const markAsRead = useCallback((fromId: number) => {
        setMessages(prev => prev.map(m =>
            m.from_id === fromId ? { ...m, is_read: true } : m
        ));
        dispatchUnreadReset();
    }, []);

    return {
        messages,
        setMessages,
        hasMore,
        loadingMore,
        initialLoading,
        editingMessageId,
        setEditingMessageId,
        editContent,
        setEditContent,
        loadInitial,
        loadMore,
        sendMessage,
        updateMessage,
        deleteMessage,
        markAsRead,
    };
};
