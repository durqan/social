import { useEffect, useState } from 'react';
import { useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import type { User } from '../types.js';
import Sidebar from './Sidebar.js';
import { useAuth } from '../contexts/AuthContext.js';
import { userService } from '../services/userService.js';
import { Icon } from './ui/Icon.js';
import { Spinner } from './ui/Spinner.js';
import { usePresence } from '../hooks/usePresence.js';
import { UserSearch } from './profile/UserSearch.js';

function Profile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
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
                userPresence={userPresence}
            />
            <div className="lg:ml-72">
                <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/90 backdrop-blur">
                    <div className="relative px-4 py-3 sm:px-6">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <h1 className="truncate text-lg font-semibold tracking-tight text-gray-950 sm:text-xl">
                                    {getPageTitle()}
                                </h1>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3">
                                {currentUser?.id === user?.id && (
                                    <button
                                        onClick={() => navigate(`/users/${id}/edit`)}
                                        className="icon-button h-10 w-10"
                                        title="Редактировать профиль"
                                    >
                                        <Icon name="edit" />
                                    </button>
                                )}
                                <button
                                    onClick={handleLogout}
                                    className="icon-button h-10 w-10 hover:text-red-600"
                                    title="Выйти"
                                >
                                    <Icon name="logout" />
                                </button>
                            </div>
                        </div>

                        <UserSearch
                            className={`${isChatPage ? 'hidden lg:block' : ''} mt-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:mt-0 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:-translate-y-1/2`}
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
