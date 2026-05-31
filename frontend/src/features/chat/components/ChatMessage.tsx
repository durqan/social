import { memo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import type { Message } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";
import { messageAuthorName, messagePreviewText } from "@/features/chat/lib/messagePreview.js";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function cleanUrl(value: string) {
    return value.replace(/[),.!?;:]+$/, '');
}

function normalizeUrl(value: string) {
    return value.startsWith('www.') ? `https://${value}` : value;
}

function linkifyText(value: string, isOwn: boolean) {
    const parts: Array<{ type: 'text' | 'link'; value: string; href?: string }> = [];
    let lastIndex = 0;

    for (const match of value.matchAll(urlPattern)) {
        const rawUrl = match[0];
        const index = match.index ?? 0;
        const cleanedUrl = cleanUrl(rawUrl);

        if (index > lastIndex) {
            parts.push({ type: 'text', value: value.slice(lastIndex, index) });
        }

        parts.push({
            type: 'link',
            value: cleanedUrl,
            href: normalizeUrl(cleanedUrl),
        });

        if (cleanedUrl.length < rawUrl.length) {
            parts.push({ type: 'text', value: rawUrl.slice(cleanedUrl.length) });
        }

        lastIndex = index + rawUrl.length;
    }

    if (lastIndex < value.length) {
        parts.push({ type: 'text', value: value.slice(lastIndex) });
    }

    return parts.map((part, index) => {
        if (part.type === 'link') {
            return (
                <a
                    key={`${part.value}-${index}`}
                    href={part.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`underline decoration-1 underline-offset-2 ${isOwn ? 'text-sky-700 hover:text-sky-900' : 'text-sky-600 hover:text-sky-800'}`}
                    onClick={event => event.stopPropagation()}
                >
                    {part.value}
                </a>
            );
        }

        return part.value;
    });
}

interface ChatMessageProps {
    message: Message;
    isOwn: boolean;
    showDate: boolean;
    isFirst: boolean;
    recipientName?: string;
    recipientAvatar?: string | null;
    recipientAvatarPositionX?: number;
    recipientAvatarPositionY?: number;
    recipientAvatarScale?: number;
    selectionMode: boolean;
    isSelected: boolean;
    isContextActive: boolean;
    canSelect: boolean;
    onToggleSelect: () => void;
    onSelectMessage: () => void;
    onReplyPreviewClick: (messageId: number) => void;
    onOpenContextMenu: (message: Message, options: {
        position: { x: number; y: number };
        source: 'mouse' | 'touch';
    }) => void;
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
                                recipientAvatar,
                                recipientAvatarPositionX,
                                recipientAvatarPositionY,
                                recipientAvatarScale,
                                selectionMode,
                                isSelected,
                                isContextActive,
                                canSelect,
                                onToggleSelect,
                                onSelectMessage,
                                onReplyPreviewClick,
                                onOpenContextMenu,
                                editingMessageId,
                                editContent,
                                setEditContent,
                                onSaveEdit,
                                onCancelEdit,
                                formatTime,
                                formatDate,
                            }: ChatMessageProps) => {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressNextClickRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const clearLongPressTimer = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const openContextMenuAt = (clientX: number, clientY: number, source: 'mouse' | 'touch') => {
        onOpenContextMenu(message, {
            position: { x: clientX, y: clientY },
            source,
        });
    };

    const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenuAt(event.clientX, event.clientY, 'mouse');
    };

    const handleMessageClick = (event: MouseEvent<HTMLDivElement>) => {
        if (!selectionMode) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (canSelect) {
            onSelectMessage();
        }
    };

    const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        clearLongPressTimer();
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };

        longPressTimer.current = setTimeout(() => {
            suppressNextClickRef.current = true;
            navigator.vibrate?.(8);
            document.getSelection()?.removeAllRanges();
            openContextMenuAt(touch.clientX, touch.clientY, 'touch');
            window.setTimeout(() => {
                suppressNextClickRef.current = false;
            }, 700);
        }, 520);
    };

    const handleTouchEnd = () => {
        clearLongPressTimer();
        touchStartRef.current = null;
    };

    const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
        const start = touchStartRef.current;
        const touch = event.touches[0];

        if (!start || !touch) {
            return;
        }

        const deltaX = Math.abs(touch.clientX - start.x);
        const deltaY = Math.abs(touch.clientY - start.y);

        if (deltaX > 8 || deltaY > 8) {
            handleTouchEnd();
        }
    };

    const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
        if (!suppressNextClickRef.current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        suppressNextClickRef.current = false;
    };

    return (
        <div
            id={isFirst ? 'msg-first' : `msg-${message.id}`}
            data-chat-message-id={message.id}
            className={`${isContextActive ? 'relative z-[60]' : ''} select-none [-webkit-touch-callout:none] [-webkit-user-select:none]`}
            style={{
                touchAction: 'manipulation',
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onClickCapture={handleClickCapture}
            onContextMenu={(e) => {
                openContextMenu(e);
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
                            disabled={!canSelect}
                            className="w-5 h-5 rounded border-gray-300 text-sky-500 focus:ring-sky-500 disabled:opacity-30"
                        />
                    </div>
                )}
                {!isOwn && !selectionMode && (
                    <Avatar
                        name={recipientName}
                        src={recipientAvatar}
                        positionX={recipientAvatarPositionX}
                        positionY={recipientAvatarPositionY}
                        scale={recipientAvatarScale}
                        size="sm"
                        className="flex-shrink-0 mr-2"
                    />
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
                        <div
                            onClick={handleMessageClick}
                            className={`rounded-2xl px-3 py-2 transition-shadow sm:px-4 ${selectionMode ? canSelect ? 'cursor-pointer' : 'opacity-60' : ''} ${isContextActive ? 'shadow-2xl ring-2 ring-white/80' : ''} ${isOwn ? 'bg-sky-50 text-slate-900 border border-sky-100 rounded-br-md' : 'bg-white text-gray-900 rounded-bl-md border border-gray-200/70'}`}
                        >
                            {message.forwarded_from_message_id && (
                                <div className={`mb-1 text-xs font-medium ${isOwn ? 'text-sky-700' : 'text-gray-500'}`}>
                                    {message.forwarded_from_user?.name
                                        ? `Переслано от ${message.forwarded_from_user.name}`
                                        : 'Пересланное сообщение'}
                                </div>
                            )}

                            {message.reply_to_message_id && (
                                <button
                                    type="button"
                                    onClick={event => {
                                        event.stopPropagation();
                                        if (message.reply_to_message_id) {
                                            onReplyPreviewClick(message.reply_to_message_id);
                                        }
                                    }}
                                    className={`mb-2 block w-full rounded-lg border-l-2 px-2 py-1.5 text-left transition ${isOwn ? 'border-sky-400 bg-white/65 hover:bg-white' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
                                >
                                    {message.reply_to_message ? (
                                        <>
                                            <span className="block truncate text-xs font-semibold text-gray-700">
                                                {messageAuthorName(message.reply_to_message)}
                                            </span>
                                            <span className="block truncate text-xs text-gray-500">
                                                {messagePreviewText(message.reply_to_message)}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="block truncate text-xs text-gray-500">Сообщение недоступно</span>
                                    )}
                                </button>
                            )}

                            {message.attachments?.length ? (
                                <div className={`grid gap-2 ${message.attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${message.content ? 'mb-2' : ''}`}>
                                    {message.attachments.map(attachment => (
                                        <button
                                            type="button"
                                            key={attachment.file_url}
                                            onClick={event => {
                                                if (selectionMode) {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    if (canSelect) {
                                                        onSelectMessage();
                                                    }
                                                    return;
                                                }

                                                setPreviewUrl(attachment.file_url);
                                            }}
                                            className="block overflow-hidden rounded-xl bg-black/5 text-left"
                                            aria-label="Открыть изображение"
                                        >
                                            <img
                                                src={attachment.file_url}
                                                alt="Вложение"
                                                className="max-h-72 w-full object-cover"
                                                loading="lazy"
                                            />
                                        </button>
                                    ))}
                                </div>
                            ) : null}

                            {message.content && (
                                <p className="text-sm break-words">
                                    {linkifyText(message.content, isOwn)}
                                </p>
                            )}

                            <div className={`text-xs mt-1 ${isOwn ? 'text-black text-right' : 'text-gray-400 text-left'}`}>
                                {formatTime(message.created_at)}
                                {isOwn && <span className="ml-1">{message.is_read ? '✓✓' : '✓'}</span>}
                            </div>
                        </div>
                    )}

                </div>
            </div>
            {previewUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
                    onClick={() => setPreviewUrl(null)}
                    role="dialog"
                    aria-modal="true"
                >
                    <button
                        type="button"
                        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                        onClick={() => setPreviewUrl(null)}
                        aria-label="Закрыть изображение"
                    >
                        <Icon name="close" className="h-5 w-5" />
                    </button>
                    <img
                        src={previewUrl}
                        alt="Вложение"
                        className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};

export const ChatMessage = memo(ChatMessageComponent);
