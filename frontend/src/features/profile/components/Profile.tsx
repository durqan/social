import { useEffect, useState } from 'react';
import { useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import type { User } from "@/shared/types/domain.js";
import Sidebar from './Sidebar.js';
import { useAuth } from "@/app/providers/AuthContext.js";
import { userService } from "@/shared/api/userService.js";
import { Icon } from "@/shared/ui/Icon.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { usePresence } from "@/shared/hooks/usePresence.js";
import { UserSearch } from "@/features/profile/components/UserSearch.js";
import { NotificationBell } from "@/features/notifications/components/NotificationBell.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";

function Profile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const dialog = useAppDialog();
    const { currentUser, logout } = useAuth();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchUser = async () => {
            if (!id) return;
            try {
                setUser(await userService.getUser(id));
            } catch (error) {
                navigate('/login');
            } finally {
                setLoading(false);
            }
        };

        fetchUser();
    }, [id, navigate]);

    const handleLogout = async () => {
        const ok = await dialog.confirm({
            title: 'Выйти из аккаунта?',
            message: 'Текущая сессия будет завершена.',
            confirmText: 'Выйти',
            cancelText: 'Отмена',
            variant: 'danger',
        });
        if (!ok) {
            return;
        }

        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    const getPageTitle = () => {
        if (location.pathname.includes('/edit')) return 'Редактирование профиля';
        if (location.pathname.includes('/wall')) return 'Моя стена';
        if (location.pathname.includes('/conversations')) return 'Сообщения';
        if (location.pathname.includes('/chat')) return 'Чат';
        return 'Моя страница';
    };

    const isChatPage = location.pathname.includes('/chat');

    const userPresence = usePresence(currentUser?.id);

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--app-bg)] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Spinner size="lg" />
                    <p className="text-gray-500">Загрузка...</p>
                </div>
            </div>
        );
    }

    const contextValue = {
        user: user!,
        setUser,
        isOwner: currentUser?.id === user?.id,
        currentUser: currentUser
    };

    return (
        <div className="min-h-screen bg-[var(--app-bg)]">
            <Sidebar
                userId={currentUser?.id}
                userName={currentUser?.name}
                userAvatar={currentUser?.avatar}
                userAvatarPositionX={currentUser?.avatarPositionX}
                userAvatarPositionY={currentUser?.avatarPositionY}
                userAvatarScale={currentUser?.avatarScale}
                userPresence={userPresence}
            />
            <div className="lg:ml-72">
                <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/90">
                    <div className="relative px-3 py-2.5 sm:px-6 sm:py-3">
                        <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
                            <div className="min-w-0 flex-1">
                                <h1 className="truncate text-base font-semibold tracking-tight text-gray-950 sm:text-xl">
                                    {getPageTitle()}
                                </h1>
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
                                <NotificationBell userId={currentUser?.id} compact />
                                {currentUser?.id === user?.id && (
                                    <button
                                        onClick={() => navigate(`/users/${id}/edit`)}
                                        className="icon-button h-9 w-9 sm:h-10 sm:w-10 cursor-pointer"
                                        title="Редактировать профиль"
                                    >
                                        <Icon name="edit" />
                                    </button>
                                )}
                                <button
                                    onClick={handleLogout}
                                    className="icon-button h-9 w-9 hover:text-red-600 sm:h-10 sm:w-10 cursor-pointer"
                                    title="Выйти"
                                >
                                    <Icon name="logout" />
                                </button>
                            </div>
                        </div>

                        <UserSearch
                            className={`${isChatPage ? 'hidden lg:block' : ''} mt-2 sm:mt-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:mt-0 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:-translate-y-1/2`}
                        />
                    </div>
                </header>

                <main className={isChatPage ? 'h-[calc(100dvh-57px)] p-0 sm:h-auto sm:p-6' : 'px-3 pb-24 pt-4 sm:p-6'}>
                    <Outlet context={contextValue} />
                </main>
            </div>
        </div>
    );
}

export default Profile;
