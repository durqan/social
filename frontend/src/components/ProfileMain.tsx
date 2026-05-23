import { useState, useEffect } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { friendService } from '../services/friendService.js';
import type { User } from '../types.js';
import {usePresence} from "../hooks/usePresence.js";
import {Avatar} from "./ui/Avatar.js";
import { authService } from '../services/authService.js';
import { getApiError } from '../api/errors.js';

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
    const [verificationLoading, setVerificationLoading] = useState(false);
    const [verificationMessage, setVerificationMessage] = useState<{
        type: 'success' | 'error';
        text: string;
    } | null>(null);
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

    const handleSendVerification = async () => {
        setVerificationLoading(true);
        setVerificationMessage(null);

        try {
            await authService.sendVerificationEmail();
            setVerificationMessage({
                type: 'success',
                text: 'Письмо для подтверждения отправлено',
            });
        } catch (err: unknown) {
            const apiError = getApiError(err);
            setVerificationMessage({
                type: 'error',
                text: apiError.message || apiError.error || 'Не удалось отправить письмо',
            });
        } finally {
            setVerificationLoading(false);
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
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <div className="relative">
                    <div className="h-24 bg-[linear-gradient(135deg,#eef2f7,#dbeafe)] sm:h-32"></div>
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 sm:-bottom-12 sm:left-6 sm:translate-x-0">
                        <div className="w-20 h-20 bg-white rounded-full p-1 sm:w-24 sm:h-24">
                            <Avatar
                                name={user?.name}
                                src={user?.avatar}
                                size="lg"
                                className="w-full h-full text-xl sm:text-2xl"
                            />
                        </div>
                    </div>
                </div>

                <div className="px-4 pb-5 pt-14 sm:px-6 sm:pb-6 sm:pt-16">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 text-center sm:text-left">
                            <h1 className="break-words text-2xl font-bold text-gray-800">{user?.name || 'Пользователь'}
                                {online && (
                                <span className="ml-2 text-green-500">●</span>
                                )}
                            </h1>
                            <p className="mt-1 break-words text-sm text-gray-500 sm:text-base">{user?.email}</p>
                            {user?.bio && (
                                <p className="mt-3 border-t border-gray-100 pt-3 text-left text-gray-700">
                                    {user.bio}
                                </p>
                            )}
                            <div className="mt-4 flex flex-col gap-2 text-sm text-gray-500 sm:flex-row sm:flex-wrap sm:gap-x-4">
                                {user?.createdAt && (
                                    <span>Участник с {formatDate(user.createdAt)}</span>
                                )}
                                {user?.isEmailVerified ? (
                                    <span className="text-emerald-600">Почта подтверждена</span>
                                ) : (
                                    <span className="text-amber-600">Почта не подтверждена</span>
                                )}
                            </div>
                            {!isOwner && friendStatus === 'accepted' && currentUser && (
                                <button
                                    onClick={() => navigate(`/users/${currentUser.id}/chat/${user.id}`)}
                                    className="mt-4 w-full rounded-xl bg-sky-600 px-4 py-2 text-sm text-white transition hover:bg-sky-700 sm:w-auto"
                                >
                                    Написать сообщение
                                </button>
                            )}
                            {isOwner && !user?.isEmailVerified && (
                                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-sm text-yellow-700">
                                            Подтвердите почту, чтобы завершить настройку аккаунта.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleSendVerification}
                                            disabled={verificationLoading}
                                            className="rounded-xl bg-amber-600 px-3 py-2 text-sm text-white transition hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                                        >
                                            {verificationLoading ? 'Отправка...' : 'Отправить письмо'}
                                        </button>
                                    </div>
                                    {verificationMessage && (
                                        <p className={`mt-2 text-sm ${
                                            verificationMessage.type === 'success'
                                                ? 'text-green-700'
                                                : 'text-red-700'
                                        }`}>
                                            {verificationMessage.text}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 sm:flex-shrink-0">
                            {!isOwner && (
                                <button
                                    onClick={handleFriendAction}
                                    className={`w-full px-4 py-2 rounded-lg text-sm transition sm:w-auto ${
                                        friendStatus === 'pending'
                                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                                            : friendStatus === 'accepted'
                                                ? 'bg-red-500 text-white hover:bg-red-600'
                                                : 'bg-sky-600 text-white hover:bg-sky-700'
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
