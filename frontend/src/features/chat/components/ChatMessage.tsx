import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { toast } from 'react-hot-toast';
import type { Message, MessageAttachment, MessageLinkPreview } from "@/shared/types/domain.js";
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
import {
    attachmentDisplayName,
    downloadAttachment,
    downloadAttachmentErrorMessage,
} from "@/features/chat/lib/attachmentDownload.js";

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

function providerLabel(provider: MessageLinkPreview['provider']) {
    switch (provider) {
        case 'youtube':
            return 'YouTube';
        case 'rutube':
            return 'RUTUBE';
        case 'instagram':
            return 'Instagram';
        default:
            return 'Видео';
    }
}

function previewDomain(raw: string) {
    try {
        return new URL(raw).hostname.replace(/^www\./, '');
    } catch {
        return raw;
    }
}

function linkPreviewImageURLs(preview: MessageLinkPreview) {
    const importedThumbnail = preview.video_attachment?.thumbnail_url;
    const candidates = preview.status === 'ready'
        ? [importedThumbnail, preview.image_url, preview.thumbnail_url]
        : [preview.image_url, preview.thumbnail_url, importedThumbnail];

    return candidates.filter((url, index): url is string =>
        Boolean(url) && candidates.indexOf(url) === index);
}

type MessageStatusKind = 'sent' | 'read';

function messageStatus(message: Message, isOwn: boolean): MessageStatusKind | undefined {
    if (!isOwn) {
        return undefined;
    }

    return message.is_read ? 'read' : 'sent';
}

function statusChecks(status?: MessageStatusKind) {
    if (!status) {
        return undefined;
    }

    return status === 'read' ? '✓✓' : '✓';
}

function MessageMeta({
    timestamp,
    status,
    standalone = false,
}: {
    timestamp: string;
    status?: MessageStatusKind;
    standalone?: boolean;
}) {
    const checks = statusChecks(status);

    return (
        <span
            className={`chat-message-meta ${standalone ? 'chat-message-meta--standalone' : ''} ${status === 'read' ? 'chat-message-meta--read' : ''}`}
        >
            <span className="chat-message-meta__time">{timestamp}</span>
            {checks ? <span className="chat-message-meta__checks">{checks}</span> : null}
        </span>
    );
}

export function LinkPreviewCard({
    preview,
    onImport,
}: {
    preview: MessageLinkPreview;
    onImport?: () => void;
}) {
    const importing = preview.status === 'importing';
    const failed = preview.status === 'failed';
    const previewImageURLs = useMemo(() => linkPreviewImageURLs(preview), [preview]);
    const previewImageKey = previewImageURLs.join('\n');
    const [failedImageURLs, setFailedImageURLs] = useState<string[]>([]);
    const previewImageURL = previewImageURLs.find(url => !failedImageURLs.includes(url)) || null;

    useEffect(() => {
        setFailedImageURLs([]);
    }, [previewImageKey]);

    return (
        <div className="mt-2 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-card-muted)]">
            {previewImageURL ? (
                <img
                    src={previewImageURL}
                    alt=""
                    className="h-40 w-full object-cover"
                    loading="lazy"
                    onError={() => setFailedImageURLs(current =>
                        current.includes(previewImageURL) ? current : [...current, previewImageURL])}
                />
            ) : (
                <div className="flex h-28 w-full items-center justify-center bg-black/10 text-[var(--app-text-secondary)]">
                    <Icon name="video" className="h-8 w-8" />
                </div>
            )}
            <div className="space-y-2 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--app-text-secondary)]">
                    <Icon name="video" className="h-4 w-4" />
                    {providerLabel(preview.provider)}
                </div>
                <div className="truncate text-sm font-medium text-[var(--app-text-primary)]">
                    {preview.title || 'Видео по ссылке'}
                </div>
                <div className="truncate text-xs text-[var(--app-text-secondary)]">
                    {previewDomain(preview.original_url)}
                </div>
                {importing ? <div className="text-xs text-[var(--app-text-secondary)]">Видео обрабатывается...</div> : null}
                {failed ? <div className="text-xs text-red-600">Не удалось сохранить видео</div> : null}
                <div className="flex flex-wrap gap-2">
                    {preview.status !== 'ready' ? (
                        <button
                            type="button"
                            disabled={importing}
                            onClick={event => {
                                event.stopPropagation();
                                onImport?.();
                            }}
                            className="rounded-lg bg-[var(--app-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                            {failed ? 'Повторить' : 'Сохранить видео в чат'}
                        </button>
                    ) : null}
                    <a
                        href={preview.original_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={event => event.stopPropagation()}
                        className="rounded-lg border border-[var(--app-border)] px-3 py-1.5 text-xs font-medium text-[var(--app-text-primary)]"
                    >
                        Открыть ссылку
                    </a>
                </div>
            </div>
        </div>
    );
}

interface ChatMessageProps {
    message: Message;
    isOwn: boolean;
    showDate: boolean;
    isFirst: boolean;
    isGroupedWithPrevious: boolean;
    isGroupedWithNext: boolean;
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
    onOpenUser?: (userId: number, anchorRect: DOMRect) => void;
    onImportLinkPreviewVideo?: (message: Message) => void;
}

const ChatMessageComponent = ({
                                message,
                                isOwn,
                                showDate,
                                isFirst,
                                isGroupedWithPrevious,
                                isGroupedWithNext,
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
                                onImportLinkPreviewVideo,
                            }: ChatMessageProps) => {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressNextClickRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const [previewAttachment, setPreviewAttachment] = useState<MessageAttachment | null>(null);
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
    const currentMessageStatus = messageStatus(message, isOwn);
    const messageStatusLabel = statusChecks(currentMessageStatus);
    const timestamp = formatTime(message.created_at);
    const previewUrl = previewAttachment?.decrypted_file_url || previewAttachment?.file_url || null;
    const rootSpacingClass = isFirst || showDate
        ? ''
        : isGroupedWithPrevious
            ? 'mt-1'
            : 'mt-2.5 sm:mt-3';
    const showIncomingAvatar = !isOwn && !selectionMode && !isGroupedWithNext;

    const handleAttachmentDownload = (attachment: MessageAttachment) => {
        void downloadAttachment(attachment).catch(error => {
            toast.error(downloadAttachmentErrorMessage(error));
        });
    };

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
            className={`chat-message-row ${rootSpacingClass} ${isContextActive ? 'relative z-[60]' : ''} select-none [-webkit-touch-callout:none] [-webkit-user-select:none]`}
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
                    showIncomingAvatar ? (
                        <Avatar
                            name={recipientName}
                            src={recipientAvatar}
                            positionX={recipientAvatarPositionX}
                            positionY={recipientAvatarPositionY}
                            scale={recipientAvatarScale}
                            size="sm"
                            className="mr-2 flex-shrink-0 self-end"
                            ariaLabel={`Открыть профиль ${recipientName || 'собеседника'}`}
                            onClick={onOpenUser ? event => onOpenUser(message.from_id, event.currentTarget.getBoundingClientRect()) : undefined}
                        />
                    ) : (
                        <div className="mr-2 h-8 w-8 flex-shrink-0" aria-hidden="true" />
                    )
                )}
                <div className="relative max-w-[82%] sm:max-w-[68%]">
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
                                : `chat-message-bubble ${isOwn ? 'chat-message-bubble--own' : 'chat-message-bubble--other'} rounded-[18px] px-3 py-1.5 transition-shadow sm:px-3.5 ${selectionMode ? canSelect ? 'cursor-pointer' : 'opacity-60' : ''} ${isContextActive ? 'shadow-2xl ring-2 ring-[var(--app-glass-border)]' : ''} ${isOwn ? 'rounded-br-md border border-[var(--app-message-own-border)] bg-[var(--app-message-own-bg)] text-[var(--app-message-own-text)]' : 'rounded-bl-md border border-[var(--app-message-other-border)] bg-[var(--app-message-other-bg)] text-[var(--app-message-other-text)]'}`}
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
                                            timestamp={isPureVideoNoteMessage && index === videoNoteAttachments.length - 1 ? timestamp : undefined}
                                            statusLabel={isPureVideoNoteMessage && index === videoNoteAttachments.length - 1 ? messageStatusLabel : undefined}
                                            selectionMode={selectionMode}
                                            canSelect={canSelect}
                                            onSelectMessage={onSelectMessage}
                                            onDownload={handleAttachmentDownload}
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
                                            onDownload={handleAttachmentDownload}
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {imageAttachments.length ? (
                                <div className={`chat-message-image-grid ${imageAttachments.length > 1 ? 'chat-message-image-grid--multi' : ''} ${message.content || videoAttachments.length || audioAttachments.length || fileAttachments.length ? 'mb-2' : ''}`}>
                                    {imageAttachments.map(attachment => (
                                        <div
                                            key={attachment.file_url}
                                            className="chat-message-image-preview"
                                        >
                                            <button
                                                type="button"
                                                onClick={event => {
                                                    if (selectionMode) {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        if (canSelect) {
                                                            onSelectMessage();
                                                        }
                                                        return;
                                                    }

                                                    setPreviewAttachment(attachment);
                                                }}
                                                className="chat-message-image-button"
                                                aria-label="Открыть изображение"
                                            >
                                                <img
                                                    src={attachment.decrypted_file_url || attachment.file_url}
                                                    alt="Вложение"
                                                    className="chat-message-image"
                                                    loading="lazy"
                                                />
                                            </button>
                                            <button
                                                type="button"
                                                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-sm backdrop-blur-sm transition hover:bg-white hover:text-[var(--app-accent)]"
                                                onClick={event => {
                                                    event.stopPropagation();
                                                    if (selectionMode) {
                                                        if (canSelect) {
                                                            onSelectMessage();
                                                        }
                                                        return;
                                                    }
                                                    handleAttachmentDownload(attachment);
                                                }}
                                                aria-label="Скачать изображение"
                                                title="Скачать"
                                            >
                                                <Icon name="download" className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {videoAttachments.length ? (
                                <div className={message.content || audioAttachments.length || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {videoAttachments.map(attachment => {
                                        const src = attachment.decrypted_file_url || attachment.file_url;
                                        const name = attachmentDisplayName(attachment, 'video.mp4');
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
                                                    <span className="min-w-0 flex-1 truncate">{name}</span>
                                                    <span>{formatFileSize(attachment.original_size || attachment.size)}</span>
                                                    <button
                                                        type="button"
                                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-[var(--app-accent)] transition hover:bg-white hover:text-[var(--app-accent-hover)]"
                                                        onClick={event => {
                                                            event.stopPropagation();
                                                            if (selectionMode) {
                                                                if (canSelect) {
                                                                    onSelectMessage();
                                                                }
                                                                return;
                                                            }
                                                            handleAttachmentDownload(attachment);
                                                        }}
                                                        aria-label="Скачать видео"
                                                        title="Скачать"
                                                    >
                                                        <Icon name="download" className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {message.link_preview ? (
                                <LinkPreviewCard
                                    preview={message.link_preview}
                                    onImport={() => onImportLinkPreviewVideo?.(message)}
                                />
                            ) : null}

                            {audioAttachments.length ? (
                                <div className={message.content || fileAttachments.length ? 'mb-2 space-y-2' : 'space-y-2'}>
                                    {audioAttachments.map(attachment => {
                                        const src = attachment.decrypted_file_url || attachment.file_url;
                                        const name = attachmentDisplayName(attachment, 'audio.mp3');
                                        return (
                                            <div key={attachment.id ?? attachment.file_url} className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-muted)] px-3 py-2">
                                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--app-text-primary)]">
                                                    <Icon name="audio" className="h-4 w-4 flex-shrink-0 text-[var(--app-accent)]" />
                                                    <span className="min-w-0 flex-1 truncate">{name}</span>
                                                    <span className="text-xs font-normal text-[var(--app-text-secondary)]">
                                                        {formatFileSize(attachment.original_size || attachment.size)}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-[var(--app-accent)] transition hover:bg-white hover:text-[var(--app-accent-hover)]"
                                                        onClick={event => {
                                                            event.stopPropagation();
                                                            if (selectionMode) {
                                                                if (canSelect) {
                                                                    onSelectMessage();
                                                                }
                                                                return;
                                                            }
                                                            handleAttachmentDownload(attachment);
                                                        }}
                                                        aria-label="Скачать аудио"
                                                        title="Скачать"
                                                    >
                                                        <Icon name="download" className="h-4 w-4" />
                                                    </button>
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
                                        const name = attachmentDisplayName(attachment, 'file');
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
                                                <button
                                                    type="button"
                                                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/80 text-[var(--app-accent)] transition hover:bg-white hover:text-[var(--app-accent-hover)]"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        if (selectionMode) {
                                                            if (canSelect) {
                                                                onSelectMessage();
                                                            }
                                                            return;
                                                        }
                                                        handleAttachmentDownload(attachment);
                                                    }}
                                                    aria-label="Скачать файл"
                                                    title="Скачать файл"
                                                >
                                                    <Icon name="download" className="h-4 w-4" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}

                            {message.content && (
                                <p className={`chat-message-text text-sm ${message.decryption_error ? 'italic text-red-600' : ''}`}>
                                    {linkifyText(message.content)}
                                    <MessageMeta timestamp={timestamp} status={currentMessageStatus} />
                                </p>
                            )}

                            {!message.content && !isPureVideoNoteMessage && (
                                <div className="chat-message-meta-row">
                                    <MessageMeta
                                        timestamp={timestamp}
                                        status={currentMessageStatus}
                                        standalone
                                    />
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
                    onClose={() => setPreviewAttachment(null)}
                    onDownload={previewAttachment ? () => handleAttachmentDownload(previewAttachment) : undefined}
                />
            )}
        </div>
    );
};

export const ChatMessage = memo(ChatMessageComponent);
