import { useNavigate } from 'react-router-dom';
import { usePresence } from '../../hooks/usePresence.js';
import { Avatar } from '../ui/Avatar.js';
import { Button } from '../ui/Button.js';
import type { User } from '../../types.js';

interface FriendItemProps {
    friend: User;
    removeFriend: (
        id: number | undefined
    ) => void;
}

function Item({friend, removeFriend,}: FriendItemProps) {
    const navigate = useNavigate();
    const { online } = usePresence(
        friend.id
    );

    return (
        <div className="
            flex flex-col gap-3
            p-3 hover:bg-gray-50
            rounded-lg transition
            sm:flex-row sm:items-center
            sm:justify-between">
            <div className="
                    flex min-w-0 items-center
                    gap-3 cursor-pointer
                    flex-1"
                onClick={() =>
                    navigate(`/users/${friend.id}`)
                }>
                <Avatar
                    name={friend.name}
                    src={friend.avatar}
                    size="lg"
                />
                <div className="min-w-0">
                    <p className="
                        truncate font-semibold text-gray-800">
                        {friend.name || 'Пользователь'}
                    </p>
                    <p className="
                        truncate text-sm text-gray-500">
                        {friend.email}
                    </p>
                    <p className={
                            online
                                ? 'text-sm text-green-500'
                                : 'text-sm text-gray-400'
                        }>
                        {online ? '● Online' : 'Offline'}
                    </p>
                </div>
            </div>
            <Button
                variant="ghost"
                onClick={() =>
                    removeFriend(friend.id)
                }
                className="
                    w-full justify-center
                    text-red-500
                    hover:text-red-700
                    sm:w-auto
                "
            >
                Удалить
            </Button>

        </div>
    );
}

export default Item;
