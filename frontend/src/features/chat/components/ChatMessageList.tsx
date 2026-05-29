import { useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage.js';
import type { Message } from "@/shared/types/domain.js";
import { Spinner } from "@/shared/ui/Spinner.js";

interface ChatMessageListProps {
    messages: Message[];
    currentUserId?: number;
    recipientName?: string;
    selectionMode: boolean;
    selectedMessages: Set<number>;
    onToggleSelect: (id: number) => void;
    onEnterSelectionMode: (id: number) => void;
    onEditMessage: (id: number, content: string) => void;
    onDeleteMessage: (id: number) => void;
    editingMessageId: number | null;
    editContent: string;
    setEditContent: (content: string) => void;
    onSaveEdit: (id: number, content: string) => void;
    onCancelEdit: () => void;
    loadingMore: boolean;
    onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    formatDate: (date: string) => string;
    formatTime: (date: string) => string;
    actionsEnabled?: boolean;
}

export const ChatMessageList = ({
                                    messages,
                                    currentUserId,
                                    recipientName,
                                    selectionMode,
                                    selectedMessages,
                                    onToggleSelect,
                                    onEnterSelectionMode,
                                    onEditMessage,
                                    onDeleteMessage,
                                    editingMessageId,
                                    editContent,
                                    setEditContent,
                                    onSaveEdit,
                                    onCancelEdit,
                                    loadingMore,
                                    onScroll,
                                    messagesEndRef,
                                    formatDate,
                                    formatTime,
                                    actionsEnabled = true,
                                }: ChatMessageListProps) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current && loadingMore) {
            const firstMessage = document.getElementById('msg-first');
            if (firstMessage) {
                containerRef.current.scrollTop = firstMessage.offsetTop;
            }
        }
    }, [loadingMore]);

    return (
        <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto p-3 space-y-3 sm:p-4 sm:space-y-4">
            {loadingMore && (
                <div className="flex justify-center py-2">
                    <Spinner size="sm" />
                </div>
            )}
            {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-gray-400">
                    Нет сообщений. Напишите что-нибудь...
                </div>
            ) : (
                messages.map((msg, idx) => {
                    const isOwn = msg.from_id === currentUserId;
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const showDate = !prevMsg || formatDate(msg.created_at) !== formatDate(prevMsg.created_at);
                    const isFirst = idx === 0;

                    return (
                        <ChatMessage
                            key={msg.id}
                            message={msg}
                            isOwn={isOwn}
                            showDate={showDate}
                            isFirst={isFirst}
                            recipientName={recipientName}
                            selectionMode={selectionMode}
                            isSelected={selectedMessages.has(msg.id)}
                            onToggleSelect={() => onToggleSelect(msg.id)}
                            onLongPress={() => onEnterSelectionMode(msg.id)}
                            onEdit={() => onEditMessage(msg.id, msg.content)}
                            onDelete={() => onDeleteMessage(msg.id)}
                            editingMessageId={editingMessageId}
                            editContent={editContent}
                            setEditContent={setEditContent}
                            onSaveEdit={() => onSaveEdit(msg.id, editContent)}
                            onCancelEdit={onCancelEdit}
                            formatTime={formatTime}
                            formatDate={formatDate}
                            actionsEnabled={actionsEnabled}
                        />
                    );
                })
            )}
            <div ref={messagesEndRef} />
        </div>
    );
};
