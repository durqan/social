import { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import type { ProfileContextType } from "@/shared/types/domain.js";
import { usePresence } from "@/shared/hooks/usePresence.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { ImageViewer } from "@/shared/ui/ImageViewer.js";
import { formatLongDate } from "@/shared/utils/date.js";
import { EmailVerificationNotice } from "@/features/profile/components/EmailVerificationNotice.js";
import { friendButtonText, useFriendStatus } from "@/features/friends/hooks/useFriendStatus.js";
import { useEmailVerification } from "@/features/auth/hooks/useEmailVerification.js";

function ProfileMain() {
    const navigate = useNavigate();
    const { user, isOwner, currentUser } = useOutletContext<ProfileContextType>();
    const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
    const { online } = usePresence(user.id);
    const {
        friendStatus,
        friendStatusLoading,
        handleFriendAction,
    } = useFriendStatus(user.id, isOwner);
    const emailVerification = useEmailVerification();

    if (friendStatusLoading) {
        return <div>Загрузка...</div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            <div className="app-card overflow-hidden">
                <div className="relative">
                    <div className="h-24 bg-[linear-gradient(135deg,var(--app-surface-muted),var(--app-bg))] sm:h-32"></div>
                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 sm:-bottom-12 sm:left-6 sm:translate-x-0">
                        <div className="w-20 h-20 bg-surface rounded-full p-1 ring-1 ring-border sm:w-24 sm:h-24">
                            <button
                                type="button"
                                onClick={() => user?.avatar && setAvatarViewerOpen(true)}
                                disabled={!user?.avatar}
                                className="block h-full w-full rounded-full disabled:cursor-default"
                                aria-label="Открыть аватарку"
                            >
                                <Avatar
                                    name={user?.name}
                                    src={user?.avatar}
                                    positionX={user?.avatarPositionX}
                                    positionY={user?.avatarPositionY}
                                    scale={user?.avatarScale}
                                    size="lg"
                                    className="w-full h-full text-xl sm:text-2xl"
                                />
                            </button>
                        </div>
                    </div>
                </div>

                <div className="px-4 pb-5 pt-14 sm:px-6 sm:pb-6 sm:pt-16">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 text-center sm:text-left">
                            <h1 className="break-words text-2xl font-bold text-text">{user?.name || 'Пользователь'}
                                {online && (
                                <span className="ml-2 text-green-500">●</span>
                                )}
                            </h1>
                            <p className="mt-1 break-words text-sm text-text-muted sm:text-base">{user?.email}</p>
                            {user?.bio && (
                                <p className="mt-3 border-t border-border pt-3 text-left text-text-secondary">
                                    {user.bio}
                                </p>
                            )}
                            <div className="mt-4 flex flex-col gap-2 text-sm text-text-muted sm:flex-row sm:flex-wrap sm:gap-x-4">
                                {user?.createdAt && (
                                    <span>Участник с {formatLongDate(user.createdAt)}</span>
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
                                    className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-sm text-white transition hover:bg-primary-hover sm:w-auto"
                                >
                                    Написать сообщение
                                </button>
                            )}
                            {isOwner && !user?.isEmailVerified && (
                                <EmailVerificationNotice {...emailVerification} />
                            )}
                        </div>
                        <div className="flex gap-2 sm:flex-shrink-0">
                            {!isOwner && (
                                <button
                                    onClick={handleFriendAction}
                                    className={`w-full px-4 py-2 rounded-lg text-sm transition sm:w-auto ${
                                        friendStatus === 'pending'
                                            ? 'bg-surface-muted text-text-muted cursor-not-allowed'
                                            : friendStatus === 'accepted'
                                                ? 'bg-danger text-white hover:bg-danger'
                                                : 'bg-primary text-white hover:bg-primary-hover'
                                    }`}
                                    disabled={friendStatus === 'pending'}
                                >
                                    {friendButtonText(friendStatus)}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {avatarViewerOpen && user?.avatar && (
                <ImageViewer
                    src={user.avatar}
                    alt={user.name || 'Аватар'}
                    onClose={() => setAvatarViewerOpen(false)}
                />
            )}
        </div>
    );
}

export default ProfileMain;
