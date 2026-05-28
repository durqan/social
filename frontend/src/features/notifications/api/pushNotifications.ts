import { notificationService, type PushSubscriptionPayload } from "@/features/notifications/api/notificationService.js";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushNotificationStatus =
    | 'unconfigured'
    | 'unsupported'
    | 'denied'
    | 'prompt'
    | 'granted';

function base64URLToUint8Array(base64URL: string) {
    const padding = '='.repeat((4 - (base64URL.length % 4)) % 4);
    const base64 = `${base64URL}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; i += 1) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

function serializeSubscription(userId: number, subscription: PushSubscription): PushSubscriptionPayload | null {
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!json.endpoint || !p256dh || !auth) {
        return null;
    }

    return {
        user_id: userId,
        endpoint: json.endpoint,
        keys: {
            p256dh,
            auth,
        },
    };
}

export async function enablePushNotifications(userId: number) {
    if (!vapidPublicKey) {
        return;
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return;
    }

    if (Notification.permission === 'denied') {
        return;
    }

    const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

    if (permission !== 'granted') {
        return;
    }

    await navigator.serviceWorker.register('/sw.js');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64URLToUint8Array(vapidPublicKey),
        });
    }

    const payload = serializeSubscription(userId, subscription);
    if (!payload) {
        return;
    }

    await notificationService.subscribePush(payload);
}

export async function hasPushSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return false;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
        return false;
    }

    const subscription = await registration.pushManager.getSubscription();
    return Boolean(subscription);
}

export function getPushNotificationStatus(): PushNotificationStatus {
    if (!vapidPublicKey) {
        return 'unconfigured';
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return 'unsupported';
    }

    if (Notification.permission === 'denied') {
        return 'denied';
    }

    if (Notification.permission === 'granted') {
        return 'granted';
    }

    return 'prompt';
}
