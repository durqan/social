import { useRef, useEffect, useMemo, useState, type UIEvent } from 'react';
import { ChatMessage } from './ChatMessage.js';
import type { Message } from "@/shared/types/domain.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { Icon } from "@/shared/ui/Icon.js";

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
    icon: 'edit' | 'delete' | 'text' | 'link';
    onSelect: () => void;
};

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
    selectionMode: boolean;
    selectedMessages: Set<number>;
    onToggleSelect: (id: number) => void;
    onEditMessage: (id: number, content: string) => void;
    onDeleteMessage: (id: number) => void;
    editingMessageId: number | null;
    editContent: string;
    setEditContent: (content: string) => void;
    onSaveEdit: (id: number, content: string) => void;
    onCancelEdit: () => void;
    loadingMore: boolean;
    onScroll: (e: UIEvent<HTMLDivElement>) => void;
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
    const isMobileMenu = contextMenu?.mode === 'mobile';

    useEffect(() => {
        if (containerRef.current && loadingMore) {
            const firstMessage = document.getElementById('msg-first');
            if (firstMessage) {
                containerRef.current.scrollTop = firstMessage.offsetTop;
            }
        }
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

        const ownActionsCount = isOwn && actionsEnabled ? 2 : 0;
        const copyActionsCount = Number(Boolean(message.content.trim())) + Number(Boolean(firstUrl(message.content || '')));
        const actionCount = ownActionsCount + copyActionsCount;

        if (actionCount === 0) {
            setContextMenu(null);
            return;
        }

        const menuWidth = 224;
        const menuHeight = Math.max(62, actionCount * 44 + 10);
        const mode = options.source === 'touch' ? 'mobile' : 'desktop';

        setContextMenu({
            messageId: message.id,
            mode,
            x: Math.max(8, Math.min(options.position.x, window.innerWidth - menuWidth - 8)),
            y: Math.max(8, Math.min(options.position.y, window.innerHeight - menuHeight - 8)),
        });
    };

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        setContextMenu(null);
        onScroll(event);
    };

    const closeAndRun = (action: () => void) => {
        setContextMenu(null);
        action();
    };

    const menuActions = useMemo<MenuAction[]>(() => {
        if (!contextMessage) {
            return [];
        }

        const actions: MenuAction[] = [];

        if (contextMessageIsOwn && actionsEnabled) {
            actions.push({
                key: 'edit',
                label: 'Редактировать',
                icon: 'edit',
                onSelect: () => onEditMessage(contextMessage.id, contextMessage.content),
            });
            actions.push({
                key: 'delete',
                label: 'Удалить сообщение',
                icon: 'delete',
                tone: 'danger',
                onSelect: () => onDeleteMessage(contextMessage.id),
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
        contextMessageHasText,
        contextMessageIsOwn,
        contextMessageUrl,
        onDeleteMessage,
        onEditMessage,
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
                            isContextActive={isMobileMenu && contextMenu?.messageId === msg.id}
                            onToggleSelect={() => onToggleSelect(msg.id)}
                            onOpenContextMenu={(message, options) => openContextMenu(message, options, isOwn)}
                            editingMessageId={editingMessageId}
                            editContent={editContent}
                            setEditContent={setEditContent}
                            onSaveEdit={() => onSaveEdit(msg.id, editContent)}
                            onCancelEdit={onCancelEdit}
                            formatTime={formatTime}
                            formatDate={formatDate}
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
                    className="fixed inset-x-0 bottom-0 z-[70] rounded-t-2xl bg-white px-3 pb-[max(18px,env(safe-area-inset-bottom))] pt-2 shadow-2xl"
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    <div className="mx-auto mb-2 h-1 w-11 rounded-full bg-gray-300" />
                    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                        {menuActions.map(action => (
                            <ContextMenuAction
                                key={action.key}
                                action={action}
                                mobile
                                onSelect={() => closeAndRun(action.onSelect)}
                            />
                        ))}
                    </div>
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
            </span>
            <span className={mobile ? 'font-medium' : undefined}>{action.label}</span>
        </button>
    );
}
