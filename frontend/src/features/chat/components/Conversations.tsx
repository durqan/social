import { useCallback, useEffect, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Conversation } from "@/shared/types/domain.js";
import { messageService } from "@/features/chat/api/messageService.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { useAuth } from "@/app/providers/AuthContext.js";
import { formatMonthDayDate } from "@/shared/utils/date.js";
import { Icon } from "@/shared/ui/Icon.js";
import { useWebSocket } from "@/app/providers/WebSocketContext.js";
import type { WsEvent } from "@/shared/types/ws.js";

type ConversationMenuState = {
    userId: number;
    mode: 'desktop' | 'mobile';
    x: number;
    y: number;
};

function Conversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [menu, setMenu] = useState<ConversationMenuState | null>(null);
    const [confirmUserId, setConfirmUserId] = useState<number | null>(null);
    const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const wsService = useWebSocket();

    const fetchConversations = useCallback(async () => {
        try {
            setConversations(await messageService.getConversations());
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
                case 'message:new':
                case 'message:update':
                    if (event.payload.from_id === currentUser.id || event.payload.to_id === currentUser.id) {
                        void fetchConversations();
                    }
                    return;

                case 'message:read':
                    if (event.payload.from_id === currentUser.id || event.payload.to_id === currentUser.id) {
                        void fetchConversations();
                    }
                    return;

                case 'message:delete':
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
    const confirmConversation = confirmUserId
        ? conversations.find(conversation => conversation.user_id === confirmUserId) ?? null
        : null;

    const openMenu = (conversation: Conversation, position: { x: number; y: number }, mode: 'desktop' | 'mobile') => {
        const menuWidth = mode === 'mobile' ? 240 : 208;
        const menuHeight = 58;

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

    const requestDeleteConversation = (userId: number) => {
        setMenu(null);
        setConfirmUserId(userId);
    };

    const confirmDeleteConversation = async () => {
        if (!confirmUserId) {
            return;
        }

        setDeletingUserId(confirmUserId);
        try {
            await messageService.deleteConversationWith(confirmUserId);
            setConversations(previous => previous.filter(conversation => conversation.user_id !== confirmUserId));
            setConfirmUserId(null);
        } catch (error) {
            console.error(error);
            alert('Не удалось удалить чат');
        } finally {
            setDeletingUserId(null);
        }
    };

    if (loading) {
        return <div className="p-4 text-center">Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <h1 className="mb-3 text-xl font-semibold tracking-tight text-text sm:mb-4 sm:text-2xl">Сообщения</h1>
            <div className="app-card overflow-hidden">
                {!conversations || conversations.length === 0 ? (
                    <div className="p-6 text-center text-text-secondary sm:p-8">Нет диалогов</div>
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
                    className="fixed inset-0 z-40 cursor-default bg-black/30 backdrop-blur-[1px]"
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
                    className="fixed z-50 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-app"
                    style={{ left: menu.x, top: menu.y }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-danger transition hover:bg-danger-soft"
                        onClick={() => requestDeleteConversation(selectedConversation.user_id)}
                    >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger-soft">
                            <Icon name="delete" className="h-3.5 w-3.5" />
                        </span>
                        Удалить чат
                    </button>
                </div>
            )}
            {confirmConversation && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                    <div className="app-card w-full max-w-sm p-5 shadow-xl sm:p-6">
                        <h2 className="mb-2 text-lg font-semibold text-text">Удалить чат?</h2>
                        <p className="mb-4 text-sm leading-5 text-text-secondary">
                            Будет удалена переписка с {confirmConversation.name}. Действие нельзя отменить.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={confirmDeleteConversation}
                                disabled={deletingUserId === confirmConversation.user_id}
                                className="flex-1 rounded-xl bg-danger px-4 py-2 text-white transition hover:bg-danger disabled:opacity-60"
                            >
                                {deletingUserId === confirmConversation.user_id ? 'Удаляем...' : 'Удалить'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmUserId(null)}
                                disabled={Boolean(deletingUserId)}
                                className="flex-1 rounded-xl bg-surface-hover px-4 py-2 text-text transition hover:bg-surface disabled:opacity-60"
                            >
                                Отмена
                            </button>
                        </div>
                    </div>
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
            className={`flex select-none items-center gap-3 border-b border-border p-3 transition last:border-b-0 [-webkit-touch-callout:none] [-webkit-user-select:none] hover:bg-surface-hover sm:p-4 ${active ? 'relative z-[60] bg-surface shadow-2xl ring-2 ring-primary/50' : ''}`}
            style={{ touchAction: 'manipulation' }}
        >
            <Avatar
                name={conversation.name}
                src={conversation.avatar}
                userId={conversation.user_id}
                positionX={conversation.avatar_position_x}
                positionY={conversation.avatar_position_y}
                scale={conversation.avatar_scale}
                size="list"
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-semibold text-text">{conversation.name}</p>
                    <p className="flex-shrink-0 text-xs text-text-muted">
                        {formatMonthDayDate(conversation.last_message_at)}
                    </p>
                </div>
                <p className="flex min-w-0 items-center gap-1 text-sm text-text-secondary">
                    <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-text-secondary">{lastSenderLabel}: </span>
                        {lastMessageText}
                    </span>
                    {conversation.last_is_mine && (
                        <span className="flex-shrink-0 text-primary">
                            {conversation.last_read ? '✓✓' : '✓'}
                        </span>
                    )}
                </p>
            </div>
            {conversation.unread_count > 0 && (
                <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-white">
                    {conversation.unread_count}
                </div>
            )}
        </div>
    );
}

export default Conversations;
