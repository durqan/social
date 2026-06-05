import { useCallback, useRef, useEffect, useLayoutEffect, useMemo, useState, type UIEvent } from 'react';
import { ChatMessage } from './ChatMessage.js';
import type { Message } from "@/shared/types/domain.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { Icon } from "@/shared/ui/Icon.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";

const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
const menuOpenedEventName = 'chat-message-context-menu:open';

type ContextMenuState = {
    messageId: number;
    mode: 'desktop' | 'mobile';
    x: number;
    y: number;
};

type MenuAction = {
    key: string;
    label: string;
    tone?: 'danger';
    icon: 'edit' | 'delete' | 'text' | 'link' | 'select' | 'reply' | 'forward' | 'pin';
    onSelect: () => void;
};

type ScrollToMessageRequest = {
    messageId: number;
    requestId: number;
};

const optimisticMessageFloor = 10000000;

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
    onDeleteMessage: (id: number) => void;
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
                                    scrollToMessageRequest,
                                }: ChatMessageListProps) => {
    const dialog = useAppDialog();
    const containerRef = useRef<HTMLDivElement>(null);
    const paginationAnchorRef = useRef<{ messageId: number; top: number } | null>(null);
    const paginationRequestRef = useRef(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const contextMessage = useMemo(() => (
        contextMenu ? messages.find(message => message.id === contextMenu.messageId) ?? null : null
    ), [contextMenu, messages]);
    const contextMessageUrl = useMemo(() => (
        contextMessage ? firstUrl(contextMessage.content || '') : ''
    ), [contextMessage]);
    const contextMessageText = contextMessage?.content.trim() ?? '';
    const contextMessageHasText = Boolean(contextMessageText);
    const contextMessageIsOwn = Boolean(contextMessage && contextMessage.from_id === currentUserId);
    const contextMessageIsReal = Boolean(contextMessage && contextMessage.id > 0 && contextMessage.id < optimisticMessageFloor);
    const contextMessageIsPinned = Boolean(contextMessage && pinnedMessageId === contextMessage.id);
    const contextMessageCanSelect = Boolean(
        contextMessage && contextMessageIsOwn && contextMessageIsReal
    );
    const isMobileMenu = contextMenu?.mode === 'mobile';

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
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener(menuOpenedEventName, closeMenu);

        return () => {
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('contextmenu', closeMenu);
            window.removeEventListener('scroll', closeMenu, true);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener(menuOpenedEventName, closeMenu);
        };
    }, [contextMenu]);

    const openContextMenu = (
        message: Message,
        options: {
            position: { x: number; y: number };
            source: 'mouse' | 'touch';
        },
        isOwn: boolean,
    ) => {
        window.dispatchEvent(new Event(menuOpenedEventName));

        const canSelect = isOwn && actionsEnabled && message.id > 0 && message.id < 10000000;
        const ownActionsCount = isOwn && actionsEnabled ? 2 : 0;
        const messageActionsCount = actionsEnabled && message.id > 0 && message.id < optimisticMessageFloor ? 3 : 0;
        const copyActionsCount = Number(Boolean(message.content.trim())) + Number(Boolean(firstUrl(message.content || '')));
        const actionCount = ownActionsCount + messageActionsCount + copyActionsCount + Number(canSelect);

        if (actionCount === 0) {
            setContextMenu(null);
            return;
        }

        const mode = options.source === 'touch' ? 'mobile' : 'desktop';
        const menuWidth = mode === 'mobile' ? 256 : 224;
        const menuHeight = Math.max(62, actionCount * (mode === 'mobile' ? 50 : 44) + 10);

        setContextMenu({
            messageId: message.id,
            mode,
            x: Math.max(8, Math.min(options.position.x, window.innerWidth - menuWidth - 8)),
            y: Math.max(8, Math.min(options.position.y, window.innerHeight - menuHeight - 8)),
        });
    };

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const container = event.currentTarget;
        setContextMenu(null);
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

        if (contextMessageIsOwn && actionsEnabled) {
            if (contextMessageCanSelect) {
                actions.push({
                    key: 'select',
                    label: 'Выбрать',
                    icon: 'select',
                    onSelect: () => onEnterSelectionMode(contextMessage.id),
                });
            }

            if (contextMessageHasText) {
                actions.push({
                    key: 'edit',
                    label: 'Редактировать',
                    icon: 'edit',
                    onSelect: () => onEditMessage(contextMessage.id, contextMessage.content),
                });
            }
            actions.push({
                key: 'delete',
                label: 'Удалить сообщение',
                icon: 'delete',
                tone: 'danger',
                onSelect: () => {
                    void dialog.confirm({
                        title: 'Удалить сообщение?',
                        message: 'Сообщение будет удалено без возможности восстановления.',
                        confirmText: 'Удалить',
                        cancelText: 'Отмена',
                        variant: 'danger',
                    }).then(ok => {
                        if (ok) {
                            void onDeleteMessage(contextMessage.id);
                        }
                    });
                },
            });
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

    return (
        <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-3 sm:p-4 sm:space-y-4">
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
                            editingMessageId={editingMessageId}
                            editContent={editContent}
                            setEditContent={setEditContent}
                            onSaveEdit={() => onSaveEdit(msg.id, editContent)}
                            onCancelEdit={onCancelEdit}
                            formatTime={formatTime}
                            formatDate={formatDate}
                            onOpenUser={onOpenUser}
                        />
                    );
                })
            )}
            {contextMenu && contextMessage && isMobileMenu && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-slate-950/35 backdrop-blur-[1px]"
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
                    className="fixed z-50 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-slate-900/10"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
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
                    className="fixed z-[70] w-64 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-2xl"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
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
            className={`flex w-full items-center gap-3 text-left transition ${mobile ? 'px-4 py-3 text-[15px]' : 'px-3 py-2.5 text-sm'} ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-800 hover:bg-gray-50'}`}
            onClick={onSelect}
        >
            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${danger ? 'bg-red-50' : action.icon === 'link' ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600'}`}>
                {action.icon === 'edit' && <Icon name="edit" className="h-3.5 w-3.5" />}
                {action.icon === 'delete' && <Icon name="delete" className="h-3.5 w-3.5" />}
                {action.icon === 'text' && <span className="text-xs font-semibold">T</span>}
                {action.icon === 'link' && <span className="text-xs font-semibold">L</span>}
                {action.icon === 'select' && <span className="h-3.5 w-3.5 rounded border-2 border-current" />}
                {action.icon === 'reply' && <span className="text-xs font-semibold">R</span>}
                {action.icon === 'forward' && <span className="text-xs font-semibold">F</span>}
                {action.icon === 'pin' && <Icon name="pin" className="h-3.5 w-3.5" />}
            </span>
            <span className={mobile ? 'font-medium' : undefined}>{action.label}</span>
        </button>
    );
}
