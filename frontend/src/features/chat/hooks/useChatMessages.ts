import { useState, useCallback } from 'react';
import { messageService } from "@/features/chat/api/messageService.js";
import {
    notificationService,
    type MarkNotificationsReadPayload,
} from "@/features/notifications/api/notificationService.js";
import type { Message } from "@/shared/types/domain.js";

const dispatchUnreadReset = () => {
    window.dispatchEvent(new Event('reset-unread'));
};

const dispatchNotificationsRead = (payload: MarkNotificationsReadPayload) => {
    window.dispatchEvent(new CustomEvent('notifications:read-matching', {
        detail: payload,
    }));
};

const messageUpdateTime = (message: Message): number | null => {
    if (!message.updated_at) {
        return null;
    }

    const time = Date.parse(message.updated_at);
    return Number.isFinite(time) ? time : null;
};

const shouldApplyMessageUpdate = (current: Message, updated: Message) => {
    const currentTime = messageUpdateTime(current);
    const updatedTime = messageUpdateTime(updated);

    if (currentTime === null || updatedTime === null) {
        return true;
    }

    return updatedTime >= currentTime;
};

type MessageTransformer = (messages: Message[]) => Promise<Message[]>;

export const useChatMessages = (userId: string | undefined, currentUserId: number | undefined, transformMessages?: MessageTransformer) => {
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
            const loadedMessages = transformMessages ? await transformMessages(res.messages) : res.messages;
            const otherUserID = Number(userId);
            setMessages(loadedMessages.map(message =>
                message.from_id === otherUserID ? { ...message, is_read: true } : message
            ));
            setHasMore(res.has_more);
            dispatchUnreadReset();
        } catch (error) {
            console.error(error);
        } finally {
            setInitialLoading(false);
        }
    }, [transformMessages, userId]);

    const loadMore = useCallback(async () => {
        if (!userId || loadingMore || !hasMore || messages.length === 0) return;
        setLoadingMore(true);
        const oldestId = messages[0]?.id;
        try {
            const res = await messageService.getMessagesWith(userId, { before: oldestId, limit: 20 });
            const newMessages = transformMessages ? await transformMessages(res.messages) : res.messages;
            setHasMore(res.has_more);
            if (newMessages.length) {
                setMessages(prev => {
                    const existingIds = new Set(prev.map(message => message.id));
                    const olderMessages = newMessages.filter(message => !existingIds.has(message.id));

                    return olderMessages.length ? [...olderMessages, ...prev] : prev;
                });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, hasMore, messages, transformMessages, userId]);

    const loadUntilMessage = useCallback(async (messageId: number) => {
        if (!userId) {
            return false;
        }

        let loadedMessages = messages;
        let canLoadMore = hasMore;

        if (loadedMessages.some(message => message.id === messageId)) {
            return true;
        }

        if (!canLoadMore || loadedMessages.length === 0) {
            return false;
        }

        setLoadingMore(true);
        try {
            for (let page = 0; page < 20; page += 1) {
                const oldestId = loadedMessages[0]?.id;
                if (!oldestId || !canLoadMore) {
                    break;
                }

                const res = await messageService.getMessagesWith(userId, { before: oldestId, limit: 20 });
                canLoadMore = res.has_more;

                if (!res.messages.length) {
                    break;
                }

                const pageMessages = transformMessages ? await transformMessages(res.messages) : res.messages;
                const existingIds = new Set(loadedMessages.map(message => message.id));
                const olderMessages = pageMessages.filter(message => !existingIds.has(message.id));
                loadedMessages = olderMessages.length ? [...olderMessages, ...loadedMessages] : loadedMessages;

                setMessages(loadedMessages);
                setHasMore(canLoadMore);

                if (loadedMessages.some(message => message.id === messageId)) {
                    return true;
                }
            }

            return loadedMessages.some(message => message.id === messageId);
        } catch (error) {
            console.error(error);
            return false;
        } finally {
            setLoadingMore(false);
        }
    }, [hasMore, messages, transformMessages, userId]);

    const sendMessage = useCallback((content: string, tempMessage: Message) => {
        setMessages(prev => [...prev, tempMessage]);
        return tempMessage;
    }, []);

    const updateMessage = useCallback(async (messageId: number, newContent: string) => {
        const updated = await messageService.updateMessage(messageId, newContent);
        setMessages(prev => prev.map(m =>
            m.id === messageId && shouldApplyMessageUpdate(m, updated) ? updated : m
        ));
    }, []);

    const applyMessageUpdate = useCallback((updated: Message) => {
        setMessages(prev => {
            let changed = false;
            const nextMessages = prev.map(message => {
                if (message.id !== updated.id) {
                    return message;
                }
                if (!shouldApplyMessageUpdate(message, updated)) {
                    return message;
                }
                changed = true;
                return updated;
            });

            return changed ? nextMessages : prev;
        });
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
        if (!currentUserId || fromId === currentUserId) {
            return;
        }

        void notificationService.markMatchingAsRead({
            types: ['message_received'],
            actor_id: fromId,
        })
            .then(() => dispatchNotificationsRead({
                types: ['message_received'],
                actor_id: fromId,
            }))
            .catch(error => {
                console.error('Ошибка отметки уведомлений сообщений:', error);
            });
    }, [currentUserId]);

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
        loadUntilMessage,
        sendMessage,
        updateMessage,
        applyMessageUpdate,
        deleteMessage,
        markAsRead,
    };
};
