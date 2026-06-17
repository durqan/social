import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from "@/shared/types/domain.js";
import { messageService } from "@/features/chat/api/messageService.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { useAuth } from "@/app/providers/AuthContext.js";
import { formatMonthDayDate } from "@/shared/utils/date.js";
import { Icon } from "@/shared/ui/Icon.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import type { WsEvent } from "@/shared/types/ws.js";
import { WS_EVENTS } from '@social/shared';

type ConversationMenuState = {
    userId: number;
    mode: 'desktop' | 'mobile';
    x: number;
    y: number;
};

const conversationTimestamp = (conversation: Conversation) => {
    const timestamp = Date.parse(conversation.last_message_at || '');
    return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortConversations = (items: Conversation[]) => [...items].sort((first, second) => {
    if (first.is_pinned !== second.is_pinned) {
        return first.is_pinned ? -1 : 1;
    }

    return conversationTimestamp(second) - conversationTimestamp(first);
});

function Conversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [menu, setMenu] = useState<ConversationMenuState | null>(null);
    const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
    const [pinningUserId, setPinningUserId] = useState<number | null>(null);
    const navigate = useNavigate();
    const dialog = useAppDialog();
    const { currentUser } = useAuth();
    const wsService = useWebSocket();

    const fetchConversations = useCallback(async () => {
        try {
            setConversations(sortConversations(await messageService.getConversations()));
        } catch (err) {
            console.error(err);
            setConversations([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchConversations();
    }, [fetchConversations]);

    useEffect(() => {
        if (!currentUser?.id) {
            return;
        }

        const handleMessage = (event: WsEvent) => {
            switch (event.type) {
                case WS_EVENTS.MESSAGE_NEW:
                case WS_EVENTS.MESSAGE_UPDATE:
                    if (event.payload.from_id === currentUser.id || event.payload.to_id === currentUser.id) {
                        void fetchConversations();
                    }
                    return;

                case WS_EVENTS.MESSAGE_READ:
                    if (event.payload.from_id === currentUser.id || event.payload.to_id === currentUser.id) {
                        void fetchConversations();
                    }
                    return;

                case WS_EVENTS.CONVERSATION_READ:
                    if (event.payload.reader_id === currentUser.id) {
                        void fetchConversations();
                    }
                    return;

                case WS_EVENTS.MESSAGE_DELETE:
                    void fetchConversations();
                    return;

                default:
                    return;
            }
        };

        wsService.onMessage(handleMessage);
        return () => wsService.removeMessageHandler(handleMessage);
    }, [currentUser?.id, fetchConversations, wsService]);

    const selectedConversation = menu
        ? conversations.find(conversation => conversation.user_id === menu.userId) ?? null
        : null;

    const openMenu = (conversation: Conversation, position: { x: number; y: number }, mode: 'desktop' | 'mobile') => {
        const menuWidth = mode === 'mobile' ? 240 : 208;
        const menuHeight = 116;

        setMenu({
            userId: conversation.user_id,
            mode,
            x: Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8)),
            y: Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8)),
        });
    };

    useEffect(() => {
        if (!menu) {
            return;
        }

        const close = () => setMenu(null);
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        };

        window.addEventListener('click', close);
        window.addEventListener('contextmenu', close);
        window.addEventListener('scroll', close, true);
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('contextmenu', close);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [menu]);

    const togglePinConversation = async (conversation: Conversation) => {
        const nextPinned = !conversation.is_pinned;
        const previousConversations = conversations;

        setMenu(null);
        setPinningUserId(conversation.user_id);
        setConversations(previous => sortConversations(previous.map(item => (
            item.user_id === conversation.user_id ? { ...item, is_pinned: nextPinned } : item
        ))));

        try {
            if (nextPinned) {
                await messageService.pinConversation(conversation.user_id);
            } else {
                await messageService.unpinConversation(conversation.user_id);
            }
            void fetchConversations();
        } catch (error) {
            console.error(error);
            setConversations(previousConversations);
            await dialog.alert({
                title: nextPinned ? 'Не удалось закрепить чат' : 'Не удалось открепить чат',
                message: 'Попробуйте повторить действие позже.',
                confirmText: 'Понятно',
                icon: 'danger',
            });
        } finally {
            setPinningUserId(null);
        }
    };

    const requestDeleteConversation = async (conversation: Conversation) => {
        setMenu(null);

        const ok = await dialog.confirm({
            title: 'Удалить чат?',
            message: `Будет удалена переписка с ${conversation.name}. Действие нельзя отменить.`,
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'danger',
        });
        if (!ok) return;

        setDeletingUserId(conversation.user_id);
        try {
            await messageService.deleteConversationWith(conversation.user_id);
            setConversations(previous => previous.filter(item => item.user_id !== conversation.user_id));
        } catch (error) {
            console.error(error);
            await dialog.alert({
                title: 'Не удалось удалить чат',
                message: 'Попробуйте повторить действие позже.',
                confirmText: 'Понятно',
                icon: 'danger',
            });
        } finally {
            setDeletingUserId(null);
        }
    };

    if (loading) {
        return <div className="p-4 text-center">Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-xl font-semibold tracking-tight text-gray-950 sm:mb-4 sm:text-2xl">Сообщения</h1>
            <div className="app-card overflow-hidden">
                {!conversations || conversations.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 sm:p-8">Нет диалогов</div>
                ) : (
                    conversations.map(conv => (
                        <ConversationItem
                            key={conv.user_id}
                            conversation={conv}
                            active={menu?.mode === 'mobile' && menu.userId === conv.user_id}
                            onOpen={() => currentUser?.id && navigate(`/users/${currentUser.id}/chat/${conv.user_id}`)}
                            onOpenMenu={openMenu}
                        />
                    ))
                )}
            </div>
            {menu?.mode === 'mobile' && selectedConversation && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-slate-950/35"
                    aria-label="Закрыть меню чата"
                    onClick={() => setMenu(null)}
                    onContextMenu={event => {
                        event.preventDefault();
                        setMenu(null);
                    }}
                />
            )}
            {menu && selectedConversation && (
                <div
                    className="fixed z-50 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl shadow-slate-900/10"
                    style={{ left: menu.x, top: menu.y }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    <button
                        type="button"
                        disabled={pinningUserId === selectedConversation.user_id}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                        onClick={() => togglePinConversation(selectedConversation)}
                    >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                            <Icon name="pin" className="h-3.5 w-3.5" />
                        </span>
                        {selectedConversation.is_pinned ? 'Открепить' : 'Закрепить'}
                    </button>
                    <button
                        type="button"
                        disabled={deletingUserId === selectedConversation.user_id}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                        onClick={() => void requestDeleteConversation(selectedConversation)}
                    >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50">
                            <Icon name="delete" className="h-3.5 w-3.5" />
                        </span>
                        Удалить чат
                    </button>
                </div>
            )}
        </div>
    );
}

function ConversationItem({
    conversation,
    active,
    onOpen,
    onOpenMenu,
}: {
    conversation: Conversation;
    active: boolean;
    onOpen: () => void;
    onOpenMenu: (conversation: Conversation, position: { x: number; y: number }, mode: 'desktop' | 'mobile') => void;
}) {
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    const suppressClickRef = useRef(false);
    const lastMessageText = conversation.last_message.trim() || 'Изображение';
    const lastSenderLabel = conversation.last_is_mine
        ? 'Вы'
        : conversation.last_sender_name || conversation.name || 'Пользователь';

    const clearLongPress = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu(conversation, { x: event.clientX, y: event.clientY }, 'desktop');
    };

    const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        if (!touch) {
            return;
        }

        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        clearLongPress();
        longPressTimer.current = setTimeout(() => {
            suppressClickRef.current = true;
            navigator.vibrate?.(8);
            onOpenMenu(conversation, { x: touch.clientX, y: touch.clientY }, 'mobile');
            window.setTimeout(() => {
                suppressClickRef.current = false;
            }, 700);
        }, 520);
    };

    const handleTouchEnd = () => {
        clearLongPress();
        touchStartRef.current = null;
    };

    const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
        const start = touchStartRef.current;
        const touch = event.touches[0];

        if (!start || !touch) {
            return;
        }

        if (Math.abs(touch.clientX - start.x) > 8 || Math.abs(touch.clientY - start.y) > 8) {
            handleTouchEnd();
        }
    };

    const handleClick = () => {
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }

        onOpen();
    };

    return (
        <div
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onTouchMove={handleTouchMove}
            className={`flex select-none items-center gap-3 cursor-pointer border-b border-gray-100 p-3 transition 
            last:border-b-0 [-webkit-touch-callout:none] [-webkit-user-select:none] 
            hover:bg-gray-50 sm:p-4 ${active ? 'relative z-[60] bg-white shadow-2xl ring-2 ring-white/80' : ''}`}
            style={{ touchAction: 'manipulation' }}
        >
            <Avatar
                name={conversation.name}
                src={conversation.avatar}
                positionX={conversation.avatar_position_x}
                positionY={conversation.avatar_position_y}
                scale={conversation.avatar_scale}
                size="list"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        {conversation.is_pinned && (
                            <span className="flex-shrink-0 text-sky-600" aria-label="Закреплен">
                                <Icon name="pin" className="h-3.5 w-3.5" />
                            </span>
                        )}
                        <p className="truncate font-semibold text-gray-950">{conversation.name}</p>
                    </div>
                    <p className="flex-shrink-0 text-xs text-gray-500">
                        {formatMonthDayDate(conversation.last_message_at)}
                    </p>
                </div>
                <p className="flex min-w-0 items-center gap-1 text-sm text-gray-500">
                    <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-gray-600">{lastSenderLabel}: </span>
                        {lastMessageText}
                    </span>
                    {conversation.last_is_mine && (
                        <span className="flex-shrink-0 text-sky-600">
                            {conversation.last_read ? '✓✓' : '✓'}
                        </span>
                    )}
                </p>
            </div>
            {conversation.unread_count > 0 && (
                <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-xs text-white">
                    {conversation.unread_count}
                </div>
            )}
        </div>
    );
}

export default Conversations;
