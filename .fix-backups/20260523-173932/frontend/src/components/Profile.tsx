import { useEffect, useState } from 'react';
import { useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import type { User } from '../types.js';
import Sidebar from './Sidebar.js';
import { useAuth } from '../contexts/AuthContext.js';
import { userService } from '../services/userService.js';
import { Avatar } from './ui/Avatar.js';
import { Icon } from './ui/Icon.js';
import { Spinner } from './ui/Spinner.js';
import {usePresence} from "../hooks/usePresence.js";

function Profile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser, logout } = useAuth();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<User[]>([]);

    const searchUsers = async (query: string) => {
        try {
            setSearchResults(await userService.searchUsers(query));
        } catch (error) {
            console.error('Ошибка поиска:', error);
            setSearchResults([]);
        }
    };

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

    const userPresence = usePresence(
        currentUser?.id
    );

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
                                <button
                                    onClick={() => navigate(`/users/${id}/edit`)}
                                    className="icon-button h-10 w-10"
                                    title="Редактировать профиль"
                                >
                                    <Icon name="edit" />
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="icon-button h-10 w-10 hover:text-red-600"
                                    title="Выйти"
                                >
                                    <Icon name="logout" />
                                </button>
                            </div>
                        </div>

                        <div className={`${isChatPage ? 'hidden lg:block' : ''} mt-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:mt-0 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:-translate-y-1/2`}>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        if (e.target.value.length > 2) {
                                            searchUsers(e.target.value);
                                        } else {
                                            setSearchResults([]);
                                        }
                                    }}
                                    placeholder="Поиск пользователей..."
                                    className="app-input px-4 py-2 pl-10 pr-4"
                                />
                                <Icon name="search" className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 z-20 max-h-80 overflow-y-auto">
                                        {searchResults.map(searchUser => (
                                            <div
                                                key={searchUser.id}
                                                onClick={() => {
                                                    navigate(`/users/${searchUser.id}`);
                                                    setSearchQuery('');
                                                    setSearchResults([]);
                                                }}
                                                className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition"
                                            >
                                                <Avatar name={searchUser.name} src={searchUser.avatar} />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-gray-800 truncate">{searchUser.name || 'Пользователь'}</p>
                                                    <p className="text-xs text-gray-500 truncate">{searchUser.email}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
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
