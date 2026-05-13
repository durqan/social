import { useOutletContext, useNavigate } from 'react-router-dom';
import type { User } from '../types.js';

interface ProfileContext {
    user: User;
    setUser?: (user: User) => void;
    isOwner?: boolean;
    currentUser?: User;
}

function ProfileMain() {
    const { user, isOwner, currentUser } = useOutletContext<ProfileContext>();
    const navigate = useNavigate();

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Недавно';
        const date = new Date(dateString);
        return date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

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
                            <h1 className="text-2xl font-bold text-gray-800">{user?.name || 'Пользователь'}</h1>
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
                            {!isOwner && currentUser && (
                                <button
                                    onClick={() => navigate(`/users/${currentUser.id}/chat/${user.id}`)}
                                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm mt-2"
                                >
                                    Написать сообщение
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                                Online
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default ProfileMain;