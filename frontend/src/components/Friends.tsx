import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { friendService } from '../services/friendService.js';
import type { User, Friendship } from '../types.js';

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
            // Обновить список друзей
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
        <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="flex border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('friends')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'friends'
                                ? 'text-blue-600 border-b-2 border-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Друзья ({friends.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('requests')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                            activeTab === 'requests'
                                ? 'text-blue-600 border-b-2 border-blue-600'
                                : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Заявки ({requests.length})
                    </button>
                </div>

                <div className="p-4">
                    {activeTab === 'friends' && (
                        friends.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">У вас пока нет друзей</p>
                        ) : (
                            <div className="space-y-3">
                                {friends.map(friend => (
                                    <div key={friend.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition">
                                        <div
                                            className="flex items-center gap-3 cursor-pointer flex-1"
                                            onClick={() => navigate(`/users/${friend.id}`)}
                                        >
                                            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                                                {friend.name?.charAt(0).toUpperCase() || '😎'}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-800">{friend.name || 'Пользователь'}</p>
                                                <p className="text-sm text-gray-500">{friend.email}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeFriend(friend.id)}
                                            className="text-red-500 hover:text-red-700 text-sm"
                                        >
                                            Удалить
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )
                    )}

                    {activeTab === 'requests' && (
                        requests.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">Нет входящих заявок</p>
                        ) : (
                            <div className="space-y-3">
                                {requests.map(req => req.user && (
                                    <div key={req.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition">
                                        <div
                                            className="flex items-center gap-3 cursor-pointer flex-1"
                                            onClick={() => navigate(`/users/${req.user!.id}`)}
                                        >
                                            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
                                                {req.user.name?.charAt(0).toUpperCase() || '😎'}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-800">{req.user.name || 'Пользователь'}</p>
                                                <p className="text-sm text-gray-500">{req.user.email}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => acceptRequest(req.id)}
                                            className="px-4 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
                                        >
                                            Принять
                                        </button>
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