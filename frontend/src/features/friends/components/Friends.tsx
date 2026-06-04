import { useEffect, useState } from 'react';
import { friendService } from "@/features/friends/api/friendService.js";
import {
    notificationService,
    type MarkNotificationsReadPayload,
} from "@/features/notifications/api/notificationService.js";
import type { User, Friendship } from "@/shared/types/domain.js";
import { FriendItem } from "@/features/friends/components/FriendItem.js";
import { FriendRequestItem } from "@/features/friends/components/FriendRequestItem.js";
import { Icon } from "@/shared/ui/Icon.js";

type FriendsTab = 'friends' | 'requests';
type FriendMenuState = {
    friendId: number;
    mode: 'desktop' | 'mobile';
    x: number;
    y: number;
};

const dispatchNotificationsRead = (payload: MarkNotificationsReadPayload) => {
    window.dispatchEvent(new CustomEvent('notifications:read-matching', {
        detail: payload,
    }));
};

const tabClass = (active: boolean) => (
    `flex-1 px-4 py-3 text-sm font-medium transition-colors ${
        active ? 'text-primary border-b-2 border-primary' : 'text-text-muted hover:text-text-secondary'
    }`
);

function Friends() {
    const [friends, setFriends] = useState<User[]>([]);
    const [requests, setRequests] = useState<Friendship[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<FriendsTab>('friends');
    const [menu, setMenu] = useState<FriendMenuState | null>(null);
    const [confirmFriendId, setConfirmFriendId] = useState<number | null>(null);
    const [deletingFriendId, setDeletingFriendId] = useState<number | null>(null);

    const selectedFriend = menu
        ? friends.find(friend => friend.id === menu.friendId) ?? null
        : null;
    const confirmFriend = confirmFriendId
        ? friends.find(friend => friend.id === confirmFriendId) ?? null
        : null;

    useEffect(() => {
        Promise.all([
            friendService.getFriendsList(),
            friendService.getFriendRequests(),
        ]).then(([friendsData, requestsData]) => {
            setFriends(friendsData);
            setRequests(requestsData);
        }).catch(console.error).finally(() => setLoading(false));

        const payload: MarkNotificationsReadPayload = {
            types: ['friend_accepted'],
        };

        void notificationService.markMatchingAsRead(payload)
            .then(() => dispatchNotificationsRead(payload))
            .catch(error => {
                console.error('Ошибка отметки уведомлений друзей:', error);
            });
    }, []);

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

    const acceptRequest = async (friendshipId: number, actorId: number) => {
        try {
            await friendService.acceptFriendRequest(friendshipId);
            setRequests(prev => prev.filter(r => r.id !== friendshipId));
            window.dispatchEvent(new Event('friend-requests:changed'));
            const newFriends = await friendService.getFriendsList();
            setFriends(newFriends);

            const payload = {
                types: ['friend_request'],
                actor_id: actorId,
            };
            void notificationService.markMatchingAsRead(payload)
                .then(() => dispatchNotificationsRead(payload))
                .catch(error => {
                    console.error('Ошибка отметки уведомлений заявок:', error);
                });
        } catch (error) {
            console.error(error);
        }
    };

    const openFriendMenu = (friend: User, position: { x: number; y: number }, mode: 'desktop' | 'mobile') => {
        if (!friend.id) {
            return;
        }

        const menuWidth = mode === 'mobile' ? 240 : 208;
        const menuHeight = 58;

        setMenu({
            friendId: friend.id,
            mode,
            x: Math.max(8, Math.min(position.x, window.innerWidth - menuWidth - 8)),
            y: Math.max(8, Math.min(position.y, window.innerHeight - menuHeight - 8)),
        });
    };

    const requestRemoveFriend = (friendId: number) => {
        setMenu(null);
        setConfirmFriendId(friendId);
    };

    const confirmRemoveFriend = async () => {
        if (!confirmFriendId) {
            return;
        }

        setDeletingFriendId(confirmFriendId);
        try {
            await friendService.removeFriend(confirmFriendId);
            setFriends(prev => prev.filter(f => f.id !== confirmFriendId));
            setConfirmFriendId(null);
        } catch (error) {
            console.error(error);
            alert('Не удалось удалить из друзей');
        } finally {
            setDeletingFriendId(null);
        }
    };

    if (loading) {
        return <div className="p-4 text-center">Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <div className="flex border-b border-border bg-surface-muted">
                    <button
                        type="button"
                        onClick={() => {
                            setMenu(null);
                            setActiveTab('friends');
                        }}
                        className={tabClass(activeTab === 'friends')}
                    >
                        Друзья ({friends.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setMenu(null);
                            setActiveTab('requests');
                        }}
                        className={tabClass(activeTab === 'requests')}
                    >
                        Заявки ({requests.length})
                    </button>
                </div>

                <div className="p-3 sm:p-4">
                    {activeTab === 'friends' && (
                        friends.length === 0 ? (
                            <p className="text-center text-text-muted py-8">У вас пока нет друзей</p>
                        ) : (
                            <div className="space-y-2">
                                {friends.map(friend => (
                                    <FriendItem
                                        key={friend.id}
                                        friend={friend}
                                        active={menu?.mode === 'mobile' && menu.friendId === friend.id}
                                        onOpenMenu={openFriendMenu}
                                    />
                                ))}
                            </div>
                        )
                    )}
                    {activeTab === 'requests' && (
                        requests.length === 0 ? (
                            <p className="text-center text-text-muted py-8">Нет входящих заявок</p>
                        ) : (
                            <div className="space-y-2">
                                {requests.map(req => req.user && (
                                    <FriendRequestItem
                                        key={req.id}
                                        request={req}
                                        onAccept={acceptRequest}
                                    />
                                ))}
                            </div>
                        )
                    )}
                </div>
            </div>
            {menu?.mode === 'mobile' && selectedFriend && (
                <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default bg-slate-950/35 backdrop-blur-[1px]"
                    aria-label="Закрыть меню друга"
                    onClick={() => setMenu(null)}
                    onContextMenu={event => {
                        event.preventDefault();
                        setMenu(null);
                    }}
                />
            )}
            {menu && selectedFriend && (
                <div
                    className="fixed z-50 w-52 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-app"
                    style={{ left: menu.x, top: menu.y }}
                    onClick={event => event.stopPropagation()}
                    onContextMenu={event => event.preventDefault()}
                >
                    <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                        onClick={() => requestRemoveFriend(selectedFriend.id!)}
                    >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-50">
                            <Icon name="delete" className="h-3.5 w-3.5" />
                        </span>
                        Удалить из друзей
                    </button>
                </div>
            )}
            {confirmFriend && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                    <div className="app-card w-full max-w-sm p-5 shadow-xl sm:p-6">
                        <h2 className="mb-2 text-lg font-semibold text-text">Удалить из друзей?</h2>
                        <p className="mb-4 text-sm leading-5 text-text-secondary">
                            {confirmFriend.name || confirmFriend.email || 'Пользователь'} будет удалён из списка друзей.
                        </p>
                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={confirmRemoveFriend}
                                disabled={deletingFriendId === confirmFriend.id}
                                className="flex-1 rounded-xl bg-danger px-4 py-2 text-white transition hover:bg-danger disabled:opacity-60"
                            >
                                {deletingFriendId === confirmFriend.id ? 'Удаляем...' : 'Удалить'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setConfirmFriendId(null)}
                                disabled={Boolean(deletingFriendId)}
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

export default Friends;
