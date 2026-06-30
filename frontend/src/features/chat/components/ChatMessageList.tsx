import { useCallback, useRef, useEffect, useLayoutEffect, useMemo, useState, type UIEvent } from 'react';
import { ChatMessage } from './ChatMessage.js';
import type { Message } from "@/shared/types/domain.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { Icon } from "@/shared/ui/Icon.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import type { MessageDeleteMode } from "@/features/chat/api/messageService.js";
import { ReactionPicker } from "@/features/chat/components/ReactionPicker.js";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const menuOpenedEventName = 'chat-message-context-menu:open';

type ContextMenuState = {
    messageId: number;
    mode: 'desktop' | 'mobile';
    anchorX: number;
    anchorY: number;
    x: number;
    y: number;
    positioned: boolean;
};

type MenuAction = {
    key: string;
    label: string;
    tone?: 'danger';
    icon: 'edit' | 'delete' | 'text' | 'link' | 'select' | 'reply' | 'forward' | 'pin' | 'smile';
    onSelect: () => void;
};

type ScrollToMessageRequest = {
    messageId: number;
    requestId: number;
};

const optimisticMessageFloor = 10000000;
const contextMenuViewportMargin = 10;

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

async function copyToClipboard(value: string) {
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
    }
}

interface ChatMessageListProps {
    messages: Message[];
    currentUserId?: number;
    recipientName?: string;
    recipientAvatar?: string | null;
    recipientAvatarPositionX?: number;
    recipientAvatarPositionY?: number;
    recipientAvatarScale?: number;
    selectionMode: boolean;
    selectedMessages: Set<number>;
    onToggleSelect: (id: number) => void;
    onEnterSelectionMode: (id: number) => void;
    onReplyMessage: (message: Message) => void;
    onForwardMessage: (message: Message) => void;
    onPinMessage?: (message: Message) => void;
    onUnpinMessage?: () => void;
    pinnedMessageId?: number | null;
    onEditMessage: (id: number, content: string) => void;
    onDeleteMessage: (id: number, mode: MessageDeleteMode) => void;
    onToggleReaction?: (messageId: number, emoji: string) => void;
    editingMessageId: number | null;
    editContent: string;
    setEditContent: (content: string) => void;
    onSaveEdit: (id: number, content: string) => void;
    onCancelEdit: () => void;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => Promise<void>;
    onScroll: (e: UIEvent<HTMLDivElement>) => void;
    messagesEndRef: React.RefObject<HTMLDivElement | null>;
    formatDate: (date: string) => string;
    formatTime: (date: string) => string;
    actionsEnabled?: boolean;
    onOpenUser?: (userId: number) => void;
    onImportLinkPreviewVideo?: (message: Message) => void;
    scrollToMessageRequest?: ScrollToMessageRequest | null;
}

export const ChatMessageList = ({
                                    messages,
                                    currentUserId,
                                    recipientName,
                                    recipientAvatar,
                                    recipientAvatarPositionX,
                                    recipientAvatarPositionY,
                                    recipientAvatarScale,
                                    selectionMode,
                                    selectedMessages,
                                    onToggleSelect,
                                    onEnterSelectionMode,
                                    onReplyMessage,
                                    onForwardMessage,
                                    onPinMessage,
                                    onUnpinMessage,
                                    pinnedMessageId,
                                    onEditMessage,
                                    onDeleteMessage,
                                    onToggleReaction = () => undefined,
                                    editingMessageId,
                                    editContent,
                                    setEditContent,
                                    onSaveEdit,
                                    onCancelEdit,
                                    hasMore,
                                    loadingMore,
                                    onLoadMore,
                                    onScroll,
                                    messagesEndRef,
                                    formatDate,
                                    formatTime,
                                    actionsEnabled = true,
                                    onOpenUser,
                                    onImportLinkPreviewVideo,
                                    scrollToMessageRequest,
                                }: ChatMessageListProps) => {
    const dialog = useAppDialog();
    const containerRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const paginationAnchorRef = useRef<{ messageId: number; top: number } | null>(null);
    const paginationRequestRef = useRef(false);
    const reactionEffectTimerRef = useRef<number | null>(null);
    const reactionEffectKeyRef = useRef(0);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [reactionPicker, setReactionPicker] = useState<{
        messageId: number;
        anchorRect: DOMRect;
    } | null>(null);
    const [reactionEffect, setReactionEffect] = useState<{
        messageId: number;
        emoji: string;
        key: number;
    } | null>(null);
    const contextMessage = useMemo(() => (
        contextMenu ? messages.find(message => message.id === contextMenu.messageId) ?? null : null
    ), [contextMenu, messages]);
    const contextMessageUrl = useMemo(() => (
        contextMessage ? firstUrl(contextMessage.content || '') : ''
    ), [contextMessage]);
    const contextMessageText = contextMessage?.decryption_error ? '' : contextMessage?.content.trim() ?? '';
    const contextMessageHasText = Boolean(contextMessageText);
    const contextMessageIsOwn = Boolean(contextMessage && contextMessage.from_id === currentUserId);
    const contextMessageIsReal = Boolean(contextMessage && contextMessage.id > 0 && contextMessage.id < optimisticMessageFloor);
    const contextMessageIsPinned = Boolean(contextMessage && pinnedMessageId === contextMessage.id);
    const contextMessageCanSelect = Boolean(
        contextMessage && contextMessageIsOwn && contextMessageIsReal
    );
    const isMobileMenu = contextMenu?.mode === 'mobile';
    const reactionPickerMessage = reactionPicker
        ? messages.find(message => message.id === reactionPicker.messageId) ?? null
        : null;

    useLayoutEffect(() => {
        const container = containerRef.current;
        const anchor = paginationAnchorRef.current;

        if (!container || !anchor) {
            return;
        }

        const anchorElement = container.querySelector<HTMLElement>(`[data-chat-message-id="${anchor.messageId}"]`);

        if (anchorElement) {
            const nextTop = anchorElement.getBoundingClientRect().top;
            container.scrollTop += nextTop - anchor.top;
        }
    }, [messages.length, loadingMore]);

    useEffect(() => {
        if (loadingMore) {
            return;
        }

        paginationRequestRef.current = false;
        paginationAnchorRef.current = null;
    }, [loadingMore]);

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
        window.addEventListener('contextmenu', closeMenu);
        window.addEventListener('scroll', closeMenu, true);
        window.addEventListener('resize', closeMenu);
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener(menuOpenedEventName, closeMenu);

        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('contextmenu', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('resize', closeMenu);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener(menuOpenedEventName, closeMenu);
        };
    }, [contextMenu]);

    useEffect(() => () => {
        if (reactionEffectTimerRef.current !== null) {
            window.clearTimeout(reactionEffectTimerRef.current);
        }
    }, []);

    const openContextMenu = (
        message: Message,
        options: {
            position: { x: number; y: number };
            source: 'mouse' | 'touch';
        },
        isOwn: boolean,
    ) => {
        window.dispatchEvent(new Event(menuOpenedEventName));
        setReactionPicker(null);

        const canSelect = isOwn && actionsEnabled && message.id > 0 && message.id < 10000000;
        const ownActionsCount = isOwn && actionsEnabled ? 2 : 0;
        const messageActionsCount = actionsEnabled && message.id > 0 && message.id < optimisticMessageFloor ? 4 : 0;
        const copyActionsCount = message.decryption_error
            ? 0
            : Number(Boolean(message.content.trim())) + Number(Boolean(firstUrl(message.content || '')));
        const actionCount = ownActionsCount + messageActionsCount + copyActionsCount + Number(canSelect);

        if (actionCount === 0) {
            setContextMenu(null);
            return;
        }

        const mode = options.source === 'touch' ? 'mobile' : 'desktop';
        const menuWidth = mode === 'mobile' ? 256 : 224;
        const initialX = Math.max(
            contextMenuViewportMargin,
            Math.min(options.position.x, window.innerWidth - menuWidth - contextMenuViewportMargin),
        );

        setContextMenu({
            messageId: message.id,
            mode,
            anchorX: options.position.x,
            anchorY: options.position.y,
            x: initialX,
            y: Math.max(contextMenuViewportMargin, options.position.y),
            positioned: false,
        });
    };

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const container = event.currentTarget;
        setContextMenu(null);
        setReactionPicker(null);
        onScroll(event);

        if (
            !hasMore ||
            loadingMore ||
            paginationRequestRef.current ||
            messages.length === 0 ||
            container.scrollTop > 80
        ) {
            return;
        }

        const firstMessage = messages[0];
        if (!firstMessage) {
            return;
        }

        const firstMessageElement = container.querySelector<HTMLElement>(`[data-chat-message-id="${firstMessage.id}"]`);

        paginationAnchorRef.current = {
            messageId: firstMessage.id,
            top: firstMessageElement?.getBoundingClientRect().top ?? container.getBoundingClientRect().top,
        };
        paginationRequestRef.current = true;
        void onLoadMore();
    };

    const closeAndRun = (action: () => void) => {
        setContextMenu(null);
        action();
    };

    const openReactionPicker = useCallback((message: Message, anchorRect?: DOMRect) => {
        const bubble = containerRef.current?.querySelector<HTMLElement>(`[data-chat-message-bubble-id="${message.id}"]`);
        const resolvedRect = anchorRect ?? bubble?.getBoundingClientRect();
        if (!resolvedRect) {
            return;
        }
        setContextMenu(null);
        setReactionPicker({
            messageId: message.id,
            anchorRect: resolvedRect,
        });
    }, []);

    const toggleReaction = useCallback((message: Message, emoji: string) => {
        reactionEffectKeyRef.current += 1;
        setReactionEffect({
            messageId: message.id,
            emoji,
            key: reactionEffectKeyRef.current,
        });
        if (reactionEffectTimerRef.current !== null) {
            window.clearTimeout(reactionEffectTimerRef.current);
        }
        reactionEffectTimerRef.current = window.setTimeout(() => setReactionEffect(null), 820);
        onToggleReaction(message.id, emoji);
    }, [onToggleReaction]);

    const scrollToMessage = useCallback((messageId: number) => {
        const container = containerRef.current;
        const row = container?.querySelector<HTMLElement>(`[data-chat-message-id="${messageId}"]`);
        const bubble = container?.querySelector<HTMLElement>(`[data-chat-message-bubble-id="${messageId}"]`);
        if (!row || !bubble) {
            return;
        }

        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bubble.classList.remove('chat-message-bubble--navigate');
        void bubble.offsetWidth;
        bubble.classList.add('chat-message-bubble--navigate');
        window.setTimeout(() => {
            bubble.classList.remove('chat-message-bubble--navigate');
        }, 1900);
    }, []);

    useEffect(() => {
        if (!scrollToMessageRequest) {
            return;
        }

        const frame = window.requestAnimationFrame(() => scrollToMessage(scrollToMessageRequest.messageId));
        return () => window.cancelAnimationFrame(frame);
    }, [scrollToMessage, scrollToMessageRequest]);

    const menuActions = useMemo<MenuAction[]>(() => {
        if (!contextMessage) {
            return [];
        }

        const actions: MenuAction[] = [];

        if (actionsEnabled && contextMessageIsReal) {
            actions.push({
                key: 'reaction',
                label: 'Реакция',
                icon: 'smile',
                onSelect: () => {
                    if (!contextMenu) {
                        return;
                    }
                    setReactionPicker({
                        messageId: contextMessage.id,
                        anchorRect: new DOMRect(contextMenu.anchorX, contextMenu.anchorY, 1, 1),
                    });
                },
            });
            actions.push({
                key: 'reply',
                label: 'Ответить',
                icon: 'reply',
                onSelect: () => onReplyMessage(contextMessage),
            });
            actions.push({
                key: 'forward',
                label: 'Переслать',
                icon: 'forward',
                onSelect: () => onForwardMessage(contextMessage),
            });
            if (contextMessageIsPinned) {
                actions.push({
                    key: 'unpin-message',
                    label: 'Открепить сообщение',
                    icon: 'pin',
                    onSelect: () => onUnpinMessage?.(),
                });
            } else {
                actions.push({
                    key: 'pin-message',
                    label: 'Закрепить сообщение',
                    icon: 'pin',
                    onSelect: () => onPinMessage?.(contextMessage),
                });
            }
        }

        if (actionsEnabled) {
            if (contextMessageIsOwn && contextMessageCanSelect) {
                actions.push({
                    key: 'select',
                    label: 'Выбрать',
                    icon: 'select',
                    onSelect: () => onEnterSelectionMode(contextMessage.id),
                });
            }

            if (contextMessageIsOwn && contextMessageHasText) {
                actions.push({
                    key: 'edit',
                    label: 'Редактировать',
                    icon: 'edit',
                    onSelect: () => onEditMessage(contextMessage.id, contextMessage.content),
                });
            }
            actions.push({
                key: 'delete-for-me',
                label: 'Удалить у себя',
                icon: 'delete',
                tone: 'danger',
                onSelect: () => {
                    void dialog.confirm({
                        title: 'Удалить у себя?',
                        message: 'Сообщение исчезнет только в вашем чате.',
                        confirmText: 'Удалить',
                        cancelText: 'Отмена',
                        variant: 'danger',
                    }).then(ok => {
                        if (ok) {
                            void onDeleteMessage(contextMessage.id, 'for_me');
                        }
                    });
                },
            });
            if (contextMessageIsOwn && contextMessageIsReal) {
                actions.push({
                    key: 'delete-for-everyone',
                    label: 'Удалить у всех',
                    icon: 'delete',
                    tone: 'danger',
                    onSelect: () => {
                        void dialog.confirm({
                            title: 'Удалить у всех?',
                            message: 'Сообщение исчезнет у всех участников диалога.',
                            confirmText: 'Удалить',
                            cancelText: 'Отмена',
                            variant: 'danger',
                        }).then(ok => {
                            if (ok) {
                                void onDeleteMessage(contextMessage.id, 'for_everyone');
                            }
                        });
                    },
                });
            }
        }

        if (contextMessageHasText) {
            actions.push({
                key: 'copy-text',
                label: 'Скопировать текст',
                icon: 'text',
                onSelect: () => {
                    void copyToClipboard(contextMessage.content);
                },
            });
        }

        if (contextMessageUrl) {
            actions.push({
                key: 'copy-link',
                label: 'Скопировать ссылку',
                icon: 'link',
                onSelect: () => {
                    void copyToClipboard(contextMessageUrl);
                },
            });
        }

        return actions;
    }, [
        actionsEnabled,
        contextMessage,
        contextMenu,
        contextMessageCanSelect,
        contextMessageHasText,
        contextMessageIsPinned,
        contextMessageIsReal,
        contextMessageIsOwn,
        contextMessageUrl,
        onDeleteMessage,
        dialog,
        onEditMessage,
        onEnterSelectionMode,
        onForwardMessage,
        onPinMessage,
        onReplyMessage,
        onUnpinMessage,
    ]);

    useLayoutEffect(() => {
        const menu = contextMenuRef.current;
        if (!contextMenu || !menu) {
            return;
        }

        const { width, height } = menu.getBoundingClientRect();
        const maxX = Math.max(contextMenuViewportMargin, window.innerWidth - width - contextMenuViewportMargin);
        const maxY = Math.max(contextMenuViewportMargin, window.innerHeight - height - contextMenuViewportMargin);
        const x = Math.max(contextMenuViewportMargin, Math.min(contextMenu.anchorX, maxX));

        let y = contextMenu.anchorY;
        if (contextMenu.anchorY + height > window.innerHeight - contextMenuViewportMargin) {
            y = contextMenu.anchorY - height;
        }
        y = Math.max(contextMenuViewportMargin, Math.min(y, maxY));

        if (contextMenu.x === x && contextMenu.y === y && contextMenu.positioned) {
            return;
        }

        setContextMenu(current => (
            current?.messageId === contextMenu.messageId && current.mode === contextMenu.mode
                ? { ...current, x, y, positioned: true }
                : current
        ));
    }, [contextMenu, menuActions.length]);

    return (
        <div ref={containerRef} onScroll={handleScroll} className="chat-doodle-bg flex-1 overflow-y-auto p-3 sm:p-4">
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
                    const canSelect = isOwn && msg.id > 0 && msg.id < optimisticMessageFloor;
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null;
                    const showDate = !prevMsg || formatDate(msg.created_at) !== formatDate(prevMsg.created_at);
                    const isFirst = idx === 0;
                    const isGroupedWithPrevious = Boolean(
                        prevMsg &&
                        !showDate &&
                        prevMsg.from_id === msg.from_id
                    );
                    const isGroupedWithNext = Boolean(
                        nextMsg &&
                        formatDate(msg.created_at) === formatDate(nextMsg.created_at) &&
                        nextMsg.from_id === msg.from_id
                    );

                    return (
                        <ChatMessage
                            key={msg.id}
                            message={msg}
                            isOwn={isOwn}
                            showDate={showDate}
                            isFirst={isFirst}
                            isGroupedWithPrevious={isGroupedWithPrevious}
                            isGroupedWithNext={isGroupedWithNext}
                            recipientName={recipientName}
                            recipientAvatar={recipientAvatar}
                            recipientAvatarPositionX={recipientAvatarPositionX}
                            recipientAvatarPositionY={recipientAvatarPositionY}
                            recipientAvatarScale={recipientAvatarScale}
                            selectionMode={selectionMode}
                            isSelected={selectedMessages.has(msg.id)}
                            isContextActive={isMobileMenu && contextMenu?.messageId === msg.id}
                            canSelect={canSelect}
                            onToggleSelect={() => onToggleSelect(msg.id)}
                            onSelectMessage={() => onToggleSelect(msg.id)}
                            onReplyPreviewClick={scrollToMessage}
                            onOpenContextMenu={(message, options) => openContextMenu(message, options, isOwn)}
                            onOpenReactionPicker={openReactionPicker}
                            onToggleReaction={toggleReaction}
                            reactionEffect={reactionEffect?.messageId === msg.id ? reactionEffect : undefined}
                            reactionsEnabled={actionsEnabled}
                            editingMessageId={editingMessageId}
                            editContent={editContent}
                            setEditContent={setEditContent}
                            onSaveEdit={() => onSaveEdit(msg.id, editContent)}
                            onCancelEdit={onCancelEdit}
                            formatTime={formatTime}
                            formatDate={formatDate}
                            onOpenUser={onOpenUser}
                            onImportLinkPreviewVideo={onImportLinkPreviewVideo}
                        />
                    );
                })
            )}
            {contextMenu && contextMessage && isMobileMenu && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-slate-950/35"
                    aria-label="Закрыть меню сообщения"
                    onClick={() => setContextMenu(null)}
                    onContextMenu={event => {
                        event.preventDefault();
                        setContextMenu(null);
                    }}
                />
            )}
            {contextMenu && contextMessage && !isMobileMenu && (
                <div
                    ref={contextMenuRef}
                    role="menu"
                    className="fixed z-50 max-h-[calc(100vh-20px)] w-56 max-w-[calc(100vw-20px)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white/95 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)] backdrop-blur-sm"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                        visibility: contextMenu.positioned ? 'visible' : 'hidden',
                    }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    {menuActions.map(action => (
                        <ContextMenuAction
                            key={action.key}
                            action={action}
                            onSelect={() => closeAndRun(action.onSelect)}
                        />
                    ))}
                </div>
            )}
            {contextMenu && contextMessage && isMobileMenu && (
                <div
                    ref={contextMenuRef}
                    role="menu"
                    className="fixed z-[70] max-h-[calc(100vh-20px)] w-64 max-w-[calc(100vw-20px)] overflow-y-auto rounded-xl border border-gray-100 bg-white py-1 shadow-2xl"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                        visibility: contextMenu.positioned ? 'visible' : 'hidden',
                    }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    {menuActions.map(action => (
                        <ContextMenuAction
                            key={action.key}
                            action={action}
                            mobile
                            onSelect={() => closeAndRun(action.onSelect)}
                        />
                    ))}
                </div>
            )}
            {reactionPicker && reactionPickerMessage && (
                <ReactionPicker
                    anchorRect={reactionPicker.anchorRect}
                    selectedEmoji={reactionPickerMessage.reactions?.find(reaction => reaction.reacted_by_me)?.emoji}
                    onSelect={emoji => {
                        setReactionPicker(null);
                        toggleReaction(reactionPickerMessage, emoji);
                    }}
                    onClose={() => setReactionPicker(null)}
                />
            )}
            <div ref={messagesEndRef} />
        </div>
    );
};

function ContextMenuAction({
    action,
    mobile = false,
    onSelect,
}: {
    action: MenuAction;
    mobile?: boolean;
    onSelect: () => void;
}) {
    const danger = action.tone === 'danger';

    return (
        <button
            type="button"
            role="menuitem"
            className={`flex w-full items-center text-left transition-colors focus-visible:outline-none ${mobile ? 'gap-3 px-4 py-3 text-[15px]' : 'px-3.5 py-2 text-[13.5px] leading-5'} ${danger ? 'text-red-600 hover:bg-red-50/80 focus-visible:bg-red-50/80' : 'text-slate-700 hover:bg-slate-100/70 focus-visible:bg-slate-100/70'}`}
            onClick={onSelect}
        >
            {mobile && (
                <span className={`flex h-7 w-7 items-center justify-center rounded-full ${danger ? 'bg-red-50' : action.icon === 'link' ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>
                    {action.icon === 'edit' && <Icon name="edit" className="h-3.5 w-3.5" />}
                    {action.icon === 'delete' && <Icon name="delete" className="h-3.5 w-3.5" />}
                    {action.icon === 'text' && <span className="text-xs font-semibold">T</span>}
                    {action.icon === 'link' && <span className="text-xs font-semibold">L</span>}
                    {action.icon === 'select' && <span className="h-3.5 w-3.5 rounded border-2 border-current" />}
                    {action.icon === 'reply' && <span className="text-xs font-semibold">R</span>}
                    {action.icon === 'forward' && <span className="text-xs font-semibold">F</span>}
                    {action.icon === 'pin' && <Icon name="pin" className="h-3.5 w-3.5" />}
                    {action.icon === 'smile' && <Icon name="smile" className="h-3.5 w-3.5" />}
                </span>
            )}
            <span className={mobile ? 'font-medium' : undefined}>{action.label}</span>
        </button>
    );
}
