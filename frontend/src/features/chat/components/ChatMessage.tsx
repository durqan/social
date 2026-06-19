import { memo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import type { Message, MessageAttachment } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { ImageViewer } from "@/shared/ui/ImageViewer.js";
import { messageAuthorName, messagePreviewText } from "@/features/chat/lib/messagePreview.js";
import { decryptAttachmentFailureText } from "@/features/chat/lib/e2eeMessageTransform.js";
import { VoiceMessage } from "@/features/chat/components/VoiceMessage.js";
import { VideoNoteMessage } from "@/features/chat/components/VideoNoteMessage.js";
import { Icon } from "@/shared/ui/Icon.js";
import { formatFileSize } from "@/shared/utils/uploadValidation.js";
import { MessageReactions } from "@/features/chat/components/MessageReactions.js";
import { ReactionBurst } from "@/features/chat/components/ReactionBurst.js";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function cleanUrl(value: string) {
    return value.replace(/[),.!?;:]+$/, '');
}

function normalizeUrl(value: string) {
    return value.startsWith('www.') ? `https://${value}` : value;
}

function linkifyText(value: string) {
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
                    className="text-[var(--app-accent)] underline decoration-1 underline-offset-2 hover:text-[var(--app-accent-hover)]"
                    onClick={event => event.stopPropagation()}
                >
                    {part.value}
                </a>
            );
        }

        return part.value;
    });
}

function attachmentName(attachment: MessageAttachment, fallback: string) {
    if (attachment.original_filename) {
        return attachment.original_filename;
    }
    const path = (attachment.file_url || '').split('?')[0] || '';
    const last = path.split('/').filter(Boolean).pop();
    return last || fallback;
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
    onOpenReactionPicker: (message: Message, anchorRect: DOMRect) => void;
    onToggleReaction: (message: Message, emoji: string) => void;
    reactionEffect?: { emoji: string; key: number };
    reactionsEnabled: boolean;
    editingMessageId: number | null;
    editContent: string;
    setEditContent: (content: string) => void;
    onSaveEdit: () => void;
    onCancelEdit: () => void;
    formatTime: (date: string) => string;
    formatDate: (date: string) => string;
    onOpenUser?: (userId: number) => void;
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
                                onOpenReactionPicker,
                                onToggleReaction,
                                reactionEffect,
                                reactionsEnabled,
                                editingMessageId,
                                editContent,
                                setEditContent,
                                onSaveEdit,
                                onCancelEdit,
                                formatTime,
                                formatDate,
                                onOpenUser,
                            }: ChatMessageProps) => {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressNextClickRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const failedAttachments = message.attachments?.filter(attachment => attachment.decryption_error) || [];
    const imageAttachments = message.attachments?.filter(attachment => attachment.file_type === 'image' && !attachment.decryption_error) || [];
    const voiceAttachments = message.attachments?.filter(attachment => attachment.file_type === 'voice' && !attachment.decryption_error) || [];
    const videoNoteAttachments = message.attachments?.filter(attachment => attachment.file_type === 'video_note' && !attachment.decryption_error) || [];
    const videoAttachments = message.attachments?.filter(attachment => attachment.file_type === 'video' && !attachment.decryption_error) || [];
    const audioAttachments = message.attachments?.filter(attachment => attachment.file_type === 'audio' && !attachment.decryption_error) || [];
    const fileAttachments = message.attachments?.filter(attachment => attachment.file_type === 'file' && !attachment.decryption_error) || [];
    const isPureVideoNoteMessage = videoNoteAttachments.length > 0
        && !message.content
        && !imageAttachments.length
        && !voiceAttachments.length
        && !videoAttachments.length
        && !audioAttachments.length
        && !fileAttachments.length
        && !failedAttachments.length
        && !message.forwarded_from_message_id
        && !message.reply_to_message_id;
    const messageStatusLabel = isOwn ? (message.is_read ? '✓✓' : '✓') : undefined;

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
        if (!touch) {
            return;
        }

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
                        ariaLabel={`Открыть профиль ${recipientName || 'собеседника'}`}
                        onClick={onOpenUser ? () => onOpenUser(message.from_id) : undefined}
                    />
                )}
                <div className="relative max-w-[82%] sm:max-w-[70%]">
                    {reactionsEnabled && !selectionMode && editingMessageId !== message.id && message.id > 0 && message.id < 10000000 && (
                        <button
                            type="button"
                            className={`message-reaction-trigger ${isOwn ? 'message-reaction-trigger--own' : 'message-reaction-trigger--other'}`}
                            aria-label="Поставить реакцию"
                            title="Реакция"
                            onClick={event => {
                                event.stopPropagation();
                                onOpenReactionPicker(message, event.currentTarget.getBoundingClientRect());
                            }}
                        >
                            <Icon name="smile" className="h-4 w-4" />
                        </button>
                    )}
                    {editingMessageId === message.id ? (
                        <div className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-card)] px-4 py-2">
                            <textarea
                                value={editContent}
                                onChange={e => setEditContent(e.target.value)}
                                className="app-input p-2 text-sm resize-none"
                                rows={2}
                                autoFocus
                            />
                            <div className="flex gap-2 mt-2 justify-end">
                                <button onClick={onSaveEdit} className="rounded-lg app-button-primary px-3 py-1 text-xs">
                                    Сохранить
                                </button>
                                <button onClick={onCancelEdit} className="rounded-lg app-button-secondary px-3 py-1 text-xs">
                                    Отмена
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div
                            data-chat-message-bubble-id={message.id}
                            onClick={handleMessageClick}
                            className={isPureVideoNoteMessage
                                ? `chat-message-bubble video-note-message-bubble transition-shadow ${selectionMode ? canSelect ? 'cursor-pointer' : 'opacity-60' : ''} ${isContextActive ? 'rounded-full ring-2 ring-[var(--app-glass-border)]' : ''}`
                                : `chat-message-bubble rounded-2xl px-3 py-2 transition-shadow sm:px-4 ${selectionMode ? canSelect ? 'cursor-pointer' : 'opacity-60' : ''} ${isContextActive ? 'shadow-2xl ring-2 ring-[var(--app-glass-border)]' : ''} ${isOwn ? 'rounded-br-md border border-[var(--app-message-own-border)] bg-[var(--app-message-own-bg)] text-[var(--app-message-own-text)]' : 'rounded-bl-md border border-[var(--app-message-other-border)] bg-[var(--app-message-other-bg)] text-[var(--app-message-other-text)]'}`}
                        >
                            {message.forwarded_from_message_id && (
                                <div className={`mb-1 text-xs font-medium ${isOwn ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-secondary)]'}`}>
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
                                    className={`mb-2 block w-full rounded-lg border-l-2 px-2 py-1.5 text-left transition ${isOwn ? 'border-[var(--app-accent-border)] bg-[var(--app-card-muted)] hover:bg-[var(--app-card)]' : 'border-[var(--app-border-strong)] bg-[var(--app-card-muted)] hover:bg-[var(--app-hover)]'}`}
                                >
                                    {message.reply_to_message ? (
                                        <>
                                            <span className="block truncate text-xs font-semibold text-[var(--app-text-primary)]">
                                                {messageAuthorName(message.reply_to_message)}
                                            </span>
                                            <span className="block truncate text-xs text-[var(--app-text-secondary)]">
                                                {messagePreviewText(message.reply_to_message)}
                                            </span>
                                        </>
                                    ) : (
                                        <span className="block truncate text-xs text-[var(--app-text-secondary)]">Сообщение недоступно</span>
                                    )}
                                </button>
                            )}

                            {failedAttachments.length ? (
                                <div className={message.content || imageAttachments.length || voiceAttachments.length || videoNoteAttachments.length || videoAttachments.length || audioAttachments.length || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {failedAttachments.map(attachment => (
                                        <div
                                            key={attachment.id ?? attachment.file_url}
                                            className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm italic text-red-700"
                                        >
                                            {decryptAttachmentFailureText}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {videoNoteAttachments.length ? (
                                <div className={message.content || imageAttachments.length || voiceAttachments.length || videoAttachments.length || audioAttachments.length || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {videoNoteAttachments.map((attachment, index) => (
                                        <VideoNoteMessage
                                            key={attachment.id ?? attachment.file_url}
                                            attachment={attachment}
                                            isOwn={isOwn}
                                            timestamp={isPureVideoNoteMessage && index === videoNoteAttachments.length - 1 ? formatTime(message.created_at) : undefined}
                                            statusLabel={isPureVideoNoteMessage && index === videoNoteAttachments.length - 1 ? messageStatusLabel : undefined}
                                            selectionMode={selectionMode}
                                            canSelect={canSelect}
                                            onSelectMessage={onSelectMessage}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {voiceAttachments.length ? (
                                <div className={message.content || imageAttachments.length || videoAttachments.length || audioAttachments.length || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {voiceAttachments.map(attachment => (
                                        <VoiceMessage
                                            key={attachment.id ?? attachment.file_url}
                                            attachment={attachment}
                                            isOwn={isOwn}
                                            selectionMode={selectionMode}
                                            canSelect={canSelect}
                                            onSelectMessage={onSelectMessage}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {imageAttachments.length ? (
                                <div className={`grid gap-2 ${imageAttachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} ${message.content || videoAttachments.length || audioAttachments.length || fileAttachments.length ? 'mb-2' : ''}`}>
                                    {imageAttachments.map(attachment => (
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

                                                setPreviewUrl(attachment.decrypted_file_url || attachment.file_url);
                                            }}
                                            className="block overflow-hidden rounded-xl bg-black/5 text-left"
                                            aria-label="Открыть изображение"
                                        >
                                            <img
                                                src={attachment.decrypted_file_url || attachment.file_url}
                                                alt="Вложение"
                                                className="max-h-72 w-full object-cover"
                                                loading="lazy"
                                            />
                                        </button>
                                    ))}
                                </div>
                            ) : null}

                            {videoAttachments.length ? (
                                <div className={message.content || audioAttachments.length || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {videoAttachments.map(attachment => {
                                        const src = attachment.decrypted_file_url || attachment.file_url;
                                        return (
                                            <div key={attachment.id ?? attachment.file_url} className="overflow-hidden rounded-xl bg-black/5">
                                                <video
                                                    src={src}
                                                    controls
                                                    preload="metadata"
                                                    className="max-h-80 w-full bg-black"
                                                    onClick={event => event.stopPropagation()}
                                                />
                                                <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--app-text-secondary)]">
                                                    <Icon name="video" className="h-4 w-4 flex-shrink-0" />
                                                    <span className="min-w-0 flex-1 truncate">{attachmentName(attachment, 'video.mp4')}</span>
                                                    <span>{formatFileSize(attachment.original_size || attachment.size)}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {audioAttachments.length ? (
                                <div className={message.content || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {audioAttachments.map(attachment => {
                                        const src = attachment.decrypted_file_url || attachment.file_url;
                                        return (
                                            <div key={attachment.id ?? attachment.file_url} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-muted)] px-3 py-2">
                                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--app-text-primary)]">
                                                    <Icon name="audio" className="h-4 w-4 flex-shrink-0 text-[var(--app-accent)]" />
                                                    <span className="min-w-0 flex-1 truncate">{attachmentName(attachment, 'audio.mp3')}</span>
                                                    <span className="text-xs font-normal text-[var(--app-text-secondary)]">
                                                        {formatFileSize(attachment.original_size || attachment.size)}
                                                    </span>
                                                </div>
                                                <audio
                                                    src={src}
                                                    controls
                                                    preload="metadata"
                                                    className="w-full"
                                                    onClick={event => event.stopPropagation()}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {fileAttachments.length ? (
                                <div className={message.content ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {fileAttachments.map(attachment => {
                                        const src = attachment.decrypted_file_url || attachment.file_url;
                                        const name = attachmentName(attachment, 'file');
                                        return (
                                            <div key={attachment.id ?? attachment.file_url} className="flex items-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-muted)] px-3 py-2">
                                                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/70 text-[var(--app-text-secondary)]">
                                                    <Icon name="file" className="h-5 w-5" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium text-[var(--app-text-primary)]">{name}</span>
                                                    <span className="mt-0.5 block text-xs text-[var(--app-text-secondary)]">
                                                        {formatFileSize(attachment.original_size || attachment.size)}
                                                    </span>
                                                </span>
                                                <a
                                                    href={src}
                                                    download={name}
                                                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/80 text-[var(--app-accent)] transition hover:bg-white hover:text-[var(--app-accent-hover)]"
                                                    onClick={event => event.stopPropagation()}
                                                    aria-label="Скачать файл"
                                                    title="Скачать файл"
                                                >
                                                    <Icon name="download" className="h-4 w-4" />
                                                </a>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {message.content && (
                                <p className={`text-sm break-words ${message.decryption_error ? 'italic text-red-600' : ''}`}>
                                    {linkifyText(message.content)}
                                </p>
                            )}

                            {!isPureVideoNoteMessage && (
                                <div className={`mt-1 text-xs ${isOwn ? 'text-right text-[var(--app-text-secondary)]' : 'text-left text-[var(--app-text-soft)]'}`}>
                                    {formatTime(message.created_at)}
                                    {messageStatusLabel && <span className="ml-1">{messageStatusLabel}</span>}
                                </div>
                            )}
                        </div>
                    )}
                    {editingMessageId !== message.id && (
                        <MessageReactions
                            reactions={message.reactions}
                            isOwn={isOwn}
                            disabled={selectionMode || !reactionsEnabled}
                            onToggle={emoji => onToggleReaction(message, emoji)}
                        />
                    )}
                    {reactionEffect && (
                        <ReactionBurst emoji={reactionEffect.emoji} effectKey={reactionEffect.key} />
                    )}
                </div>
            </div>
            {previewUrl && (
                <ImageViewer
                    src={previewUrl}
                    alt="Вложение"
                    onClose={() => setPreviewUrl(null)}
                />
            )}
        </div>
    );
};

export const ChatMessage = memo(ChatMessageComponent);
