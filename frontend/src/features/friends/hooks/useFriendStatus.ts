import { useEffect, useState } from 'react';

import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import { friendService } from "@/features/friends/api/friendService.js";

type FriendStatus = 'none' | 'pending' | 'accepted' | 'rejected' | 'blocked';

export function useFriendStatus(userId: number | undefined, isOwner?: boolean) {
    const dialog = useAppDialog();
    const [status, setStatus] = useState<FriendStatus>('none');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isOwner || !userId) {
            setLoading(false);
            return;
        }

        setLoading(true);
        friendService.getFriendshipStatus(userId)
            .then(nextStatus => setStatus(nextStatus as FriendStatus))
            .catch(() => setStatus('none'))
            .finally(() => setLoading(false));
    }, [isOwner, userId]);

    const handleAction = async () => {
        if (!userId) {
            return;
        }

        if (status === 'none') {
            await friendService.sendFriendRequest(userId);
            setStatus('pending');
            return;
        }

        if (status === 'accepted') {
            const ok = await dialog.confirm({
                title: 'Удалить из друзей?',
                message: 'Пользователь будет удалён из списка друзей.',
                confirmText: 'Удалить',
                cancelText: 'Отмена',
                variant: 'danger',
            });
            if (!ok) {
                return;
            }

            await friendService.removeFriend(userId);
            setStatus('none');
            return;
        }

        if (status === 'pending') {
            await dialog.alert({
                title: 'Заявка уже отправлена',
                message: 'Дождитесь ответа пользователя или обновите статус позже.',
                confirmText: 'Понятно',
                icon: 'info',
            });
        }
    };

    return {
        friendStatus: status,
        friendStatusLoading: loading,
        handleFriendAction: handleAction,
    };
}

export function friendButtonText(status: FriendStatus) {
    switch (status) {
        case 'pending':
            return 'Заявка отправлена';
        case 'accepted':
            return 'Удалить из друзей';
        case 'none':
        case 'rejected':
        case 'blocked':
        default:
            return 'Добавить в друзья';
    }
}
