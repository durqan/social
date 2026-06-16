import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react';

import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { messageService } from "@/features/chat/api/messageService.js";
import { ChatInput } from "@/features/chat/components/ChatInput.js";
import { ChatMessageList } from "@/features/chat/components/ChatMessageList.js";
import { useChatMessages } from "@/features/chat/hooks/useChatMessages.js";
import { useChatScroll } from "@/features/chat/hooks/useChatScroll.js";
import { useChatWebSocket } from "@/features/chat/hooks/useChatWebSocket.js";
import { getUploadErrorMessage } from "@/shared/api/errors.js";
import type { MessageAttachment, User } from "@/shared/types/domain.js";
import { formatMonthDayDate, formatTime } from "@/shared/utils/date.js";
import { Icon } from "@/shared/ui/Icon.js";

const optimisticMessageFloor = 10000000;

type CallChatPanelProps = {
    peerUserId: number;
    peerName: string;
    currentUser: User;
    onClose: () => void;
    onSeen: () => void;
};

export function CallChatPanel({
    peerUserId,
    peerName,
    currentUser,
    onClose,
    onSeen,
}: CallChatPanelProps) {
    const wsService = useWebSocket();
    const [newMessage, setNewMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const {
        messages,
        setMessages,
        loadingMore,
        initialLoading,
        editingMessageId,
        setEditingMessageId,
        editContent,
        setEditContent,
        loadInitial,
        sendMessage: sendMessageToStore,
        updateMessage,
        applyMessageUpdate,
        markAsRead,
    } = useChatMessages(String(peerUserId), currentUser.id);
    const { messagesEndRef, handleScroll, forceScrollToBottom, scrollToBottomIfNeeded } = useChatScroll(peerUserId);
    const selectedMessages = useMemo(() => new Set<number>(), []);

    useEffect(() => {
        void loadInitial();
        wsService.sendReadReceipt(peerUserId);
        markAsRead(peerUserId);
        onSeen();
    }, [loadInitial, markAsRead, onSeen, peerUserId, wsService]);

    useEffect(() => {
        const syncActiveConversation = () => {
            if (document.visibilityState === 'visible' && document.hasFocus()) {
                wsService.setActiveConversation(peerUserId);
            } else {
                wsService.clearActiveConversation();
            }
        };

        syncActiveConversation();
        document.addEventListener('visibilitychange', syncActiveConversation);
        window.addEventListener('focus', syncActiveConversation);
        window.addEventListener('blur', syncActiveConversation);

        return () => {
            document.removeEventListener('visibilitychange', syncActiveConversation);
            window.removeEventListener('focus', syncActiveConversation);
            window.removeEventListener('blur', syncActiveConversation);
            wsService.clearActiveConversation();
        };
    }, [peerUserId, wsService]);

    useChatWebSocket({
        userId: String(peerUserId),
        currentUserId: currentUser.id,
        onTyping: () => undefined,
        onMessageDeleted: messageId => {
            setMessages(prev => prev.filter(message => message.id !== messageId));
        },
        onReadReceipt: markAsRead,
        onConversationRead: markAsRead,
        onNewMessage: useCallback((message) => {
            setMessages(prev => {
                if (prev.some(item => item.id === message.id)) {
                    return prev;
                }

                const optimisticIndex = prev.findIndex(item =>
                    item.id >= optimisticMessageFloor &&
                    item.from_id === message.from_id &&
                    item.to_id === message.to_id &&
                    item.content === message.content
                );

                if (optimisticIndex !== -1) {
                    return prev.map((item, index) => index === optimisticIndex ? message : item);
                }

                return [...prev, message];
            });

            if (message.from_id === peerUserId) {
                wsService.sendReadReceipt(peerUserId);
                markAsRead(peerUserId);
                onSeen();
            }
        }, [markAsRead, onSeen, peerUserId, setMessages, wsService]),
        onMessageUpdated: applyMessageUpdate,
        onMessagePinned: () => undefined,
        onMessageUnpinned: () => undefined,
    });

    const uploadAttachments = useCallback(async (files: File[]): Promise<MessageAttachment[]> => {
        if (!files.length) {
            return [];
        }

        if (files.length > 5) {
            throw new Error('Можно отправить максимум 5 картинок за раз');
        }

        return Promise.all(files.map(file => messageService.uploadImage(file)));
    }, []);

    const sendMessage = useCallback(async (files: File[] = []) => {
        const content = newMessage.trim();
        if (!content && files.length === 0) {
            return false;
        }

        if (!(currentUser.isEmailVerified ?? currentUser.is_email_verified ?? false)) {
            setErrorMessage('Подтвердите email, чтобы продолжить');
            return false;
        }

        try {
            setErrorMessage('');
            const attachments = await uploadAttachments(files);
            const tempMessage = {
                id: Date.now(),
                from_id: currentUser.id || 0,
                to_id: peerUserId,
                content,
                created_at: new Date().toISOString(),
                is_read: false,
                from: {
                    id: currentUser.id || 0,
                    name: currentUser.name || '',
                    email: currentUser.email || '',
                },
                attachments,
            };

            sendMessageToStore(content, tempMessage);
            wsService.send(peerUserId, content, attachments);
            forceScrollToBottom();
            setNewMessage('');
            return true;
        } catch (error) {
            console.error(error);
            setErrorMessage(getUploadErrorMessage(error, 'Не удалось отправить сообщение'));
            return false;
        }
    }, [currentUser, forceScrollToBottom, newMessage, peerUserId, sendMessageToStore, uploadAttachments, wsService]);

    const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] bg-black/45 sm:bg-black/30"
            onMouseDown={handleBackdropMouseDown}
        >
            <section className="absolute inset-x-0 bottom-0 flex max-h-[78vh] min-h-[420px] flex-col overflow-hidden rounded-t-2xl bg-[var(--app-chat-bg)] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[390px] sm:rounded-none">
                <header className="flex items-center justify-between border-b border-gray-200/80 bg-white px-4 py-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{peerName}</p>
                        <p className="text-xs text-gray-500">Чат звонка</p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        aria-label="Закрыть чат"
                        title="Закрыть чат"
                    >
                        <Icon name="close" className="h-4 w-4" />
                    </button>
                </header>

                <ChatMessageList
                    messages={messages}
                    currentUserId={currentUser.id}
                    recipientName={peerName}
                    selectionMode={false}
                    selectedMessages={selectedMessages}
                    onToggleSelect={() => undefined}
                    onEnterSelectionMode={() => undefined}
                    onReplyMessage={() => undefined}
                    onForwardMessage={() => undefined}
                    onEditMessage={(id, content) => {
                        setEditingMessageId(id);
                        setEditContent(content);
                    }}
                    onDeleteMessage={() => undefined}
                    editingMessageId={editingMessageId}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    onSaveEdit={updateMessage}
                    onCancelEdit={() => setEditingMessageId(null)}
                    hasMore={false}
                    loadingMore={loadingMore || initialLoading}
                    onLoadMore={async () => undefined}
                    onScroll={handleScroll}
                    messagesEndRef={messagesEndRef}
                    formatDate={formatMonthDayDate}
                    formatTime={formatTime}
                    actionsEnabled={false}
                />

                <ChatInput
                    value={newMessage}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                        setNewMessage(event.target.value);
                        setErrorMessage('');
                    }}
                    onSend={sendMessage}
                    errorMessage={errorMessage}
                    onErrorMessageChange={setErrorMessage}
                    onComposerLayoutChange={scrollToBottomIfNeeded}
                />
            </section>
        </div>
    );
}
