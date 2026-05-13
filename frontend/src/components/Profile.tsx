import { useEffect, useState } from 'react';
import { useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import api from '../api/axios.js';
import { authService } from '../services/authService.js';
import type { User } from '../types.js';
import Sidebar from './Sidebar.js';
import {wsService} from "../services/ws.js";

function Profile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    useEffect(() => {
        const fetchCurrentUser = async () => {
            try {
                const response = await api.get('/users/profile');
                setCurrentUser(response.data);
                wsService.connect();
            } catch (error) {
                console.error('Не авторизован');
            }
        };
        fetchCurrentUser();
    }, []);

    const searchUsers = async (query: string) => {
        try {
            const response = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
            setSearchResults(response.data);
        } catch (error) {
            console.error('Ошибка поиска:', error);
            setSearchResults([]);
        }
    };

    useEffect(() => {
        const fetchUser = async () => {
            if (!id) return;
            try {
                const response = await api.get(`/users/${id}`);
                setUser(response.data);
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
            await authService.logout();
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

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
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
        <div className="min-h-screen bg-gray-100">
            <Sidebar
                userId={currentUser?.id}
                userName={currentUser?.name}
                userAvatar={currentUser?.avatar}
            />
            <div className="lg:ml-64">
                <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
                    <div className="px-6 py-3 flex justify-between items-center">
                        <div className="pl-12 lg:pl-0">
                            <h1 className="text-xl font-semibold text-gray-800">
                                {getPageTitle()}
                            </h1>
                        </div>
                        <div className="flex-1 max-w-md mx-4">
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
                                    className="w-full px-4 py-2 pl-10 pr-4 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <svg className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto">
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
                                                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                                                    {searchUser.name?.charAt(0).toUpperCase() || '😎'}
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-gray-800">{searchUser.name || 'Пользователь'}</p>
                                                    <p className="text-xs text-gray-500">{searchUser.email}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => navigate(`/users/${id}/edit`)}
                                className="p-2 text-gray-600 hover:text-blue-600 transition-colors rounded-full hover:bg-gray-100 cursor-pointer"
                                title="Редактировать профиль"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                            <button
                                onClick={handleLogout}
                                className="p-2 text-gray-600 hover:text-red-600 transition-colors rounded-full hover:bg-gray-100 cursor-pointer"
                                title="Выйти"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </header>

                <main className="p-6">
                    <Outlet context={contextValue} />
                </main>
            </div>
        </div>
    );
}

export default Profile;