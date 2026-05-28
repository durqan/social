import { useNavigate } from 'react-router-dom';

import { usePresence } from "@/shared/hooks/usePresence.js";
import type { User } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Button } from "@/shared/ui/Button.js";

type FriendItemProps = {
    friend: User;
    onRemove: (id: number) => void;
};

export function FriendItem({ friend, onRemove }: FriendItemProps) {
    const navigate = useNavigate();
    const friendID = friend.id;
    const { online } = usePresence(friendID);

    if (!friendID) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3 rounded-xl p-3 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
            <button
                type="button"
                onClick={() => navigate(`/users/${friendID}`)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
            >
                <Avatar name={friend.name} src={friend.avatar} size="lg" />
                <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-800">
                        {friend.name || 'Пользователь'}
                    </span>
                    <span className="block truncate text-sm text-gray-500">
                        {friend.email}
                    </span>
                    <span className={online ? 'block text-sm text-green-500' : 'block text-sm text-gray-400'}>
                        {online ? 'Online' : 'Offline'}
                    </span>
                </span>
            </button>

            <Button
                variant="ghost"
                onClick={() => onRemove(friendID)}
                className="w-full justify-center text-red-500 hover:text-red-700 sm:w-auto"
            >
                Удалить
            </Button>
        </div>
    );
}
