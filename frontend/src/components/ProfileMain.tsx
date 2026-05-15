import { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { friendService } from '../services/friendService.js';
import type { User } from '../types.js';
import {usePresence} from "../hooks/usePresence.js";

interface ProfileContext {
    user: User;
    isOwner?: boolean;
    currentUser?: User;
}

function ProfileMain() {
    const navigate = useNavigate();
    const { user, isOwner, currentUser } = useOutletContext<ProfileContext>();
    const [friendStatus, setFriendStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const { online } = usePresence(user.id);

    useEffect(() => {
        if (!isOwner && user?.id) {
            friendService.getFriendshipStatus(user.id)
                .then(setFriendStatus)
                .catch(() => setFriendStatus('none'))
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, [user?.id, isOwner]);

    const handleFriendAction = async () => {
        if (!user?.id) return;

        if (friendStatus === 'none') {
            await friendService.sendFriendRequest(user.id);
            setFriendStatus('pending');
        } else if (friendStatus === 'accepted') {
            if (confirm('Удалить из друзей?')) {
                await friendService.removeFriend(user.id);
                setFriendStatus('none');
            }
        } else if (friendStatus === 'pending') {
            alert('Заявка уже отправлена');
        }
    };

    const getFriendButtonText = () => {
        switch (friendStatus) {
            case 'none': return 'Добавить в друзья';
            case 'pending': return 'Заявка отправлена ⌛';
            case 'accepted': return 'Удалить из друзей';
            default: return 'Добавить в друзья';
        }
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Недавно';
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (loading) return <div>Загрузка...</div>;

    return (
        <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="relative">
                    <div className="h-32 bg-gradient-to-r from-blue-500 to-purple-600"></div>
                    <div className="absolute -bottom-12 left-6">
                        <div className="w-24 h-24 bg-white rounded-full p-1">
                            <div className="w-full h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-3xl font-bold text-white">
                                {user?.name?.charAt(0).toUpperCase() || '😎'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="pt-16 pb-6 px-6">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">{user?.name || 'Пользователь'}
                                {online && (
                                <span className="ml-2 text-green-500">●</span>
                                )}
                            </h1>
                            <p className="text-gray-500 mt-1">{user?.email}</p>
                            {user?.bio && (
                                <p className="text-gray-700 mt-3 pt-3 border-t border-gray-100">
                                    {user.bio}
                                </p>
                            )}
                            <div className="flex gap-4 mt-4 text-sm text-gray-500">
                                {user?.createdAt && (
                                    <span>📅 Участник с {formatDate(user.createdAt)}</span>
                                )}
                                {user?.isEmailVerified ? (
                                    <span className="text-green-600">✓ Почта подтверждена</span>
                                ) : (
                                    <span className="text-yellow-600">⚡ Почта не подтверждена</span>
                                )}
                            </div>
                            {!isOwner && friendStatus === 'accepted' && currentUser && (
                                <button
                                    onClick={() => navigate(`/users/${currentUser.id}/chat/${user.id}`)}
                                    className="px-4 py-2 mt-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm"
                                >
                                    💬 Написать сообщение
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            {!isOwner && (
                                <button
                                    onClick={handleFriendAction}
                                    className={`px-4 py-2 rounded-lg text-sm transition ${
                                        friendStatus === 'pending'
                                            ? 'bg-gray-200 text-gray-600 cursor-not-allowed'
                                            : friendStatus === 'accepted'
                                                ? 'bg-red-500 text-white hover:bg-red-600'
                                                : 'bg-blue-500 text-white hover:bg-blue-600'
                                    }`}
                                    disabled={friendStatus === 'pending'}
                                >
                                    {getFriendButtonText()}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ProfileMain;