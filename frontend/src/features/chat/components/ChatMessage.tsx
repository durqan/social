import { memo, useRef } from 'react';
import type { Message } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

interface ChatMessageProps {
    message: Message;
    isOwn: boolean;
    showDate: boolean;
    isFirst: boolean;
    recipientName?: string;
    selectionMode: boolean;
    isSelected: boolean;
    onToggleSelect: () => void;
    onLongPress: () => void;
    onEdit: () => void;
    onDelete: () => void;
    editingMessageId: number | null;
    editContent: string;
    setEditContent: (content: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    formatTime: (date: string) => string;
    formatDate: (date: string) => string;
}

const ChatMessageComponent = ({
                                message,
                                isOwn,
                                showDate,
                                isFirst,
                                recipientName,
                                selectionMode,
                                isSelected,
                                onToggleSelect,
                                onLongPress,
                                onEdit,
                                onDelete,
                                editingMessageId,
                                editContent,
                                setEditContent,
                                onSaveEdit,
                                onCancelEdit,
                                formatTime,
                                formatDate,
                            }: ChatMessageProps) => {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleTouchStart = () => {
        longPressTimer.current = setTimeout(() => {
            onLongPress();
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    return (
        <div
            id={isFirst ? 'msg-first' : `msg-${message.id}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                onLongPress();
            }}
        >
            {showDate && (
                <div className="flex justify-center my-4">
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-gray-500 shadow-sm">
                        {formatDate(message.created_at)}
                    </span>
                </div>
            )}
            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                {selectionMode && (
                    <div className="mr-2 flex items-center">
                        <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={onToggleSelect}
                            className="w-5 h-5 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                        />
                    </div>
                )}
                {!isOwn && !selectionMode && (
                    <Avatar name={recipientName} size="sm" className="flex-shrink-0 mr-2" />
                )}
                <div className="relative max-w-[82%] sm:max-w-[70%]">
                    {editingMessageId === message.id ? (
                        <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-2">
                            <textarea
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                className="app-input p-2 text-sm resize-none"
                                rows={2}
                                autoFocus
                            />
                            <div className="flex gap-2 mt-2 justify-end">
                                <button onClick={onSaveEdit} className="rounded-lg bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700">
                                    Сохранить
                                </button>
                                <button onClick={onCancelEdit} className="rounded-lg bg-gray-100 px-3 py-1 text-xs text-gray-800 hover:bg-gray-200">
                                    Отмена
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className={`rounded-2xl px-3 py-2 sm:px-4 ${isOwn ? 'bg-sky-50 text-slate-900 border border-sky-100 rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md border border-gray-200/70'}`}>
                            {message.attachments?.length ? (
                                <div className={`grid gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${message.content ? 'mb-2' : ''}`}>
                                    {message.attachments.map(attachment => (
                                        <a
                                            key={attachment.file_url}
                                            href={attachment.file_url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="block overflow-hidden rounded-xl bg-black/5"
                                        >
                                            <img
                                                src={attachment.file_url}
                                                alt="Вложение"
                                                className="max-h-72 w-full object-cover"
                                                loading="lazy"
                                            />
                                        </a>
                                    ))}
                                </div>
                            ) : null}

                            {message.content && <p className="text-sm break-words">{message.content}</p>}

                            <div className={`text-xs mt-1 ${isOwn ? 'text-black text-right' : 'text-gray-400 text-left'}`}>
                                {formatTime(message.created_at)}
                                {isOwn && <span className="ml-1">{message.is_read ? '✓✓' : '✓'}</span>}
                            </div>
                        </div>
                    )}

                    {!selectionMode && (
                        <div className={`absolute top-1/2 hidden -translate-y-1/2 gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100 sm:flex ${isOwn ? '-left-20' : '-right-20'}`}>
                            {isOwn && (
                                <button
                                    onClick={onEdit}
                                    className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm hover:bg-gray-100"
                                    title="Редактировать"
                                >
                                    <Icon name="edit" className="w-3.5 h-3.5 text-gray-600" />
                                </button>
                            )}
                            <button
                                onClick={onDelete}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm hover:bg-red-50"
                                title="Удалить"
                            >
                                <Icon name="delete" className="w-3.5 h-3.5 text-gray-600 hover:text-red-500" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ChatMessage = memo(ChatMessageComponent);
