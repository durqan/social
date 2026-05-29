import { useEffect, useRef } from 'react';

import { useAuth } from "@/app/providers/AuthContext.js";
import { enablePushNotifications, getPushNotificationStatus } from "@/features/notifications/api/pushNotifications.js";

export function PushSubscriptionManager() {
    const { currentUser } = useAuth();
    const attemptedUserIDRef = useRef<number | null>(null);

    useEffect(() => {
        const userID = currentUser?.id;
        if (!userID || attemptedUserIDRef.current === userID) {
            return;
        }
        if (getPushNotificationStatus() !== 'granted') {
            return;
        }

        attemptedUserIDRef.current = userID;
        enablePushNotifications().catch(error => {
            console.error('Ошибка подключения push-уведомлений:', error);
        });
    }, [currentUser?.id]);

    return null;
}
