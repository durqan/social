import { useEffect, useState } from 'react';
import { friendService } from "@/features/friends/api/friendService.js";
import type { User, Friendship } from "@/shared/types/domain.js";
import { FriendItem } from "@/features/friends/components/FriendItem.js";
import { FriendRequestItem } from "@/features/friends/components/FriendRequestItem.js";

type FriendsTab = 'friends' | 'requests';

const tabClass = (active: boolean) => (
    `flex-1 px-4 py-3 text-sm font-medium transition-colors ${
        active ? 'text-sky-700 border-b-2 border-sky-600' : 'text-gray-500 hover:text-gray-700'
    }`
);

function Friends() {
    const [friends, setFriends] = useState<User[]>([]);
    const [requests, setRequests] = useState<Friendship[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<FriendsTab>('friends');

    useEffect(() => {
        Promise.all([
            friendService.getFriendsList(),
            friendService.getFriendRequests(),
        ]).then(([friendsData, requestsData]) => {
            setFriends(friendsData);
            setRequests(requestsData);
        }).catch(console.error).finally(() => setLoading(false));
    }, []);

    const acceptRequest = async (friendshipId: number) => {
        try {
            await friendService.acceptFriendRequest(friendshipId);
            setRequests(prev => prev.filter(r => r.id !== friendshipId));
            window.dispatchEvent(new Event('friend-requests:changed'));
            const newFriends = await friendService.getFriendsList();
            setFriends(newFriends);
        } catch (error) {
            console.error(error);
        }
    };

    const removeFriend = async (friendId: number) => {
        if (!confirm('Удалить из друзей?')) return;
        try {
            await friendService.removeFriend(friendId);
            setFriends(prev => prev.filter(f => f.id !== friendId));
        } catch (error) {
            console.error(error);
        }
    };

    if (loading) {
        return <div className="p-4 text-center">Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <div className="flex border-b border-gray-200/80 bg-gray-50/70">
                    <button
                        type="button"
                        onClick={() => setActiveTab('friends')}
                        className={tabClass(activeTab === 'friends')}
                    >
                        Друзья ({friends.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('requests')}
                        className={tabClass(activeTab === 'requests')}
                    >
                        Заявки ({requests.length})
                    </button>
                </div>

                <div className="p-3 sm:p-4">
                    {activeTab === 'friends' && (
                        friends.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">У вас пока нет друзей</p>
                        ) : (
                            <div className="space-y-2">
                                {friends.map(friend => (
                                    <FriendItem
                                        key={friend.id}
                                        friend={friend}
                                        onRemove={removeFriend}
                                    />
                                ))}
                            </div>
                        )
                    )}
                    {activeTab === 'requests' && (
                        requests.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">Нет входящих заявок</p>
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
        </div>
    );
}

export default Friends;
