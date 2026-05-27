import { useEffect, useRef } from 'react';

import { useAuth } from '../../contexts/AuthContext.js';
import { enablePushNotifications } from '../../services/pushNotifications.js';

export function PushSubscriptionManager() {
    const { currentUser } = useAuth();
    const attemptedUserIDRef = useRef<number | null>(null);

    useEffect(() => {
        const userID = currentUser?.id;
        if (!userID || attemptedUserIDRef.current === userID) {
            return;
        }

        attemptedUserIDRef.current = userID;
        enablePushNotifications(userID).catch(error => {
            console.error('Ошибка подключения push-уведомлений:', error);
        });
    }, [currentUser?.id]);

    return null;
}
