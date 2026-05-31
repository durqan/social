import { useNavigate } from 'react-router-dom';

import type { Friendship } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Button } from "@/shared/ui/Button.js";

type FriendRequestItemProps = {
    request: Friendship;
    onAccept: (id: number, actorId: number) => void;
};

export function FriendRequestItem({ request, onAccept }: FriendRequestItemProps) {
    const navigate = useNavigate();
    const user = request.user;

    if (!user?.id) {
        return null;
    }

    return (
        <div className="flex flex-col gap-3 rounded-xl p-3 transition hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                onClick={() => navigate(`/users/${user.id}`)}
            >
                <Avatar name={user.name} src={user.avatar} size="list" />
                <span className="min-w-0">
                    <span className="block truncate font-semibold text-gray-800">
                        {user.name || 'Пользователь'}
                    </span>
                    <span className="block truncate text-sm text-gray-500">
                        {user.email}
                    </span>
                </span>
            </button>

            <Button
                onClick={() => onAccept(request.id, user.id)}
                className="w-full py-2 sm:w-auto sm:py-1"
            >
                Принять
            </Button>
        </div>
    );
}
