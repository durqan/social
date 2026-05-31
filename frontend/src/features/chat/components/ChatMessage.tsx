import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Message } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function cleanUrl(value: string) {
    return value.replace(/[),.!?;:]+$/, '');
}

function normalizeUrl(value: string) {
    return value.startsWith('www.') ? `https://${value}` : value;
}

function firstUrl(value: string) {
    const match = value.match(urlPattern)?.[0];
    return match ? normalizeUrl(cleanUrl(match)) : '';
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
    actionsEnabled?: boolean;
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
                                actionsEnabled = true,
                            }: ChatMessageProps) => {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const messageUrl = useMemo(() => firstUrl(message.content || ''), [message.content]);
    const hasText = Boolean(message.content.trim());

    useEffect(() => {
        if (!contextMenu) {
            return;
        }

        const closeMenu = () => setContextMenu(null);
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeMenu();
            }
        };

        window.addEventListener('click', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [contextMenu]);

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

    const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        const menuWidth = 224;
        const menuHeight = hasText && messageUrl ? 150 : hasText || messageUrl ? 106 : 62;

        setContextMenu({
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
        });
    };

    const copyToClipboard = async (value: string) => {
        if (!value) {
            return;
        }

        try {
            await navigator.clipboard.writeText(value);
        } catch {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        } finally {
            setContextMenu(null);
        }
    };

    return (
        <div
            id={isFirst ? 'msg-first' : `msg-${message.id}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
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
                                        <button
                                            type="button"
                                            key={attachment.file_url}
                                            onClick={() => setPreviewUrl(attachment.file_url)}
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
                                <p className="select-text text-sm break-words">
                                    {linkifyText(message.content, isOwn)}
                                </p>
                            )}

                            <div className={`text-xs mt-1 ${isOwn ? 'text-black text-right' : 'text-gray-400 text-left'}`}>
                                {formatTime(message.created_at)}
                                {isOwn && <span className="ml-1">{message.is_read ? '✓✓' : '✓'}</span>}
                            </div>
                        </div>
                    )}

                    {actionsEnabled && !selectionMode && (
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
            {contextMenu && (
                <div
                    className="fixed z-50 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-slate-900/10"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    {hasText && (
                        <button
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 transition hover:bg-gray-50"
                            onClick={() => void copyToClipboard(message.content)}
                        >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">T</span>
                            Скопировать текст
                        </button>
                    )}
                    {messageUrl && (
                        <button
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-800 transition hover:bg-gray-50"
                            onClick={() => void copyToClipboard(messageUrl)}
                        >
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-50 text-xs font-semibold text-sky-700">L</span>
                            Скопировать ссылку
                        </button>
                    )}
                    <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                        onClick={() => {
                            setContextMenu(null);
                            onDelete();
                        }}
                    >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50">
                            <Icon name="delete" className="h-3.5 w-3.5" />
                        </span>
                        Удалить сообщение
                    </button>
                </div>
            )}
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
