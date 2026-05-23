import { memo, useRef } from 'react';
import type { Message } from '../../types.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

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
                    <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
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
                            className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                        />
                    </div>
                )}
                {!isOwn && !selectionMode && (
                    <Avatar name={recipientName} size="sm" className="flex-shrink-0 mr-2" />
                )}
                <div className="relative max-w-[82%] sm:max-w-[70%]">
                    {editingMessageId === message.id ? (
                        <div className="bg-white rounded-2xl px-4 py-2 shadow-sm">
                            <textarea
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                className="w-full p-2 text-sm border rounded-lg resize-none"
                                rows={2}
                                autoFocus
                            />
                            <div className="flex gap-2 mt-2 justify-end">
                                <button onClick={onSaveEdit} className="px-3 py-1 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                                    Сохранить
                                </button>
                                <button onClick={onCancelEdit} className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                                    Отмена
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className={`rounded-2xl px-3 py-2 sm:px-4 ${isOwn ? 'bg-blue-500 text-white rounded-br-sm' : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'}`}>
                            <p className="text-sm break-words">{message.content}</p>
                            <div className={`text-xs mt-1 ${isOwn ? 'text-blue-100 text-right' : 'text-gray-400 text-left'}`}>
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
                                    className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center shadow-sm"
                                    title="Редактировать"
                                >
                                    <Icon name="edit" className="w-3.5 h-3.5 text-gray-600" />
                                </button>
                            )}
                            <button
                                onClick={onDelete}
                                className="w-7 h-7 rounded-full bg-gray-200 hover:bg-red-200 flex items-center justify-center shadow-sm"
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
