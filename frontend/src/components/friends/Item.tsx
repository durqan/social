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
            flex items-center
            justify-between
            p-3 hover:bg-gray-50
            rounded-lg transition">
            <div className="
                    flex items-center
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
                <div>
                    <p className="
                        font-semibold text-gray-800">
                        {friend.name || 'Пользователь'}
                    </p>
                    <p className="
                        text-sm text-gray-500">
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
                    text-red-500
                    hover:text-red-700
                "
            >
                Удалить
            </Button>

        </div>
    );
}

export default Item;