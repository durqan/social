import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { friendService } from '../services/friendService.js';
import type { User, Friendship } from '../types.js';
import { Avatar } from './ui/Avatar.js';
import { Button } from './ui/Button.js';
import {usePresence} from "../hooks/usePresence.js";
import Item from "./friends/Item.js";

function Friends() {
    const navigate = useNavigate();
    const [friends, setFriends] = useState<User[]>([]);
    const [requests, setRequests] = useState<Friendship[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'friends' | 'requests'>('friends');

    useEffect(() => {
        Promise.all([
            friendService.getFriendsList(),
            friendService.getFriendRequests()
        ]).then(([friendsData, requestsData]) => {
            setFriends(friendsData);
            setRequests(requestsData);
        }).catch(console.error).finally(() => setLoading(false));
    }, []);

    const acceptRequest = async (friendshipId: number) => {
        try {
            await friendService.acceptFriendRequest(friendshipId);
            setRequests(prev => prev.filter(r => r.id !== friendshipId));
            const newFriends = await friendService.getFriendsList();
            setFriends(newFriends);
        } catch (error) {
            console.error(error);
        }
    };

    const removeFriend = async (friendId: number | undefined) => {
        if (!confirm('Удалить из друзей?')) return;
        try {
            await friendService.removeFriend(friendId);
            setFriends(prev => prev.filter(f => f.id !== friendId));
        } catch (error) {
            console.error(error);
        }
    };

    if (loading) return <div className="p-4 text-center">Загрузка...</div>;

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <div className="flex border-b border-gray-200/80 bg-gray-50/70">
                    <button
                        onClick={() => setActiveTab('friends')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'friends'
                                ? 'text-sky-700 border-b-2 border-sky-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Друзья ({friends.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('requests')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'requests'
                                ? 'text-sky-700 border-b-2 border-sky-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
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
                                    <Item
                                        key={friend.id}
                                        friend={friend}
                                        removeFriend={removeFriend}
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
                                    <div key={req.id} className="flex flex-col gap-3 rounded-xl p-3 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
                                        <div
                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                                            onClick={() => navigate(`/users/${req.user!.id}`)}
                                        >
                                            <Avatar name={req.user.name} src={req.user.avatar} size="lg" />
                                            <div className="min-w-0">
                                                <p className="truncate font-semibold text-gray-800">{req.user.name || 'Пользователь'}</p>
                                                <p className="truncate text-sm text-gray-500">{req.user.email}</p>
                                            </div>
                                        </div>
                                        <Button
                                            onClick={() => acceptRequest(req.id)}
                                            className="w-full py-2 sm:w-auto sm:py-1"
                                        >
                                            Принять
                                        </Button>
                                    </div>
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
