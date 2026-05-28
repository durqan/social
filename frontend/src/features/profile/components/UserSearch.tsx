import { useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { userService } from "@/shared/api/userService.js";
import type { User } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

type UserSearchProps = {
    className?: string;
};

export function UserSearch({ className = '' }: UserSearchProps) {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);

    const searchUsers = async (nextQuery: string) => {
        if (nextQuery.length <= 2) {
            setResults([]);
            return;
        }

        try {
            setResults(await userService.searchUsers(nextQuery));
        } catch (error) {
            console.error('Ошибка поиска:', error);
            setResults([]);
        }
    };

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        const nextQuery = event.target.value;

        setQuery(nextQuery);
        void searchUsers(nextQuery);
    };

    const openUser = (userId: number) => {
        navigate(`/users/${userId}`);
        setQuery('');
        setResults([]);
    };

    return (
        <div className={className}>
            <div className="relative">
                <input
                    type="text"
                    value={query}
                    onChange={handleChange}
                    placeholder="Поиск пользователей..."
                    className="app-input px-4 py-2 pl-10 pr-4"
                />
                <Icon name="search" className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />

                {results.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 z-20 max-h-80 overflow-y-auto">
                        {results.map(user => {
                            const userID = user.id;
                            if (!userID) return null;

                            return (
                                <button
                                    key={userID}
                                    type="button"
                                    onClick={() => openUser(userID)}
                                    className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-gray-50"
                                >
                                    <Avatar name={user.name} src={user.avatar} />
                                    <span className="min-w-0">
                                        <span className="block truncate font-semibold text-gray-800">
                                            {user.name || 'Пользователь'}
                                        </span>
                                        <span className="block truncate text-xs text-gray-500">
                                            {user.email}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
