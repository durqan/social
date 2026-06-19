import { notificationService, type PushSubscriptionPayload } from "@/features/notifications/api/notificationService.js";

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export type PushNotificationStatus =
    | 'unconfigured'
    | 'unsupported'
    | 'denied'
    | 'prompt'
    | 'granted';

export type PushEnableResult =
    | { ok: true; endpoint: string }
    | { ok: false; reason: 'unconfigured' | 'unsupported' | 'denied' | 'permission-dismissed' | 'subscription-unavailable' };

export type PushBootstrapResult = {
    status: PushNotificationStatus;
    endpoint?: string;
};

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

function serializeSubscription(subscription: PushSubscription): PushSubscriptionPayload | null {
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!json.endpoint || !p256dh || !auth) {
        return null;
    }

    return {
        endpoint: json.endpoint,
        keys: {
            p256dh,
            auth,
        },
    };
}

async function registerServiceWorker() {
    const registeredWorker = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await registeredWorker.update().catch(error => {
        console.error('Ошибка обновления service worker:', error);
    });
    return navigator.serviceWorker.ready;
}

async function subscribeRegisteredWorker(
    registration: ServiceWorkerRegistration,
    applicationServerKey: string,
    shouldPersist: () => boolean,
): Promise<PushEnableResult> {
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64URLToUint8Array(applicationServerKey),
        });
    }

    const payload = serializeSubscription(subscription);
    if (!payload) {
        return { ok: false, reason: 'subscription-unavailable' };
    }
    if (!shouldPersist()) {
        throw new Error('Push bootstrap superseded by another session');
    }

    await notificationService.subscribePush(payload);
    window.dispatchEvent(new Event('push:subscription-changed'));
    return { ok: true, endpoint: payload.endpoint };
}

function isPushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function ensureWebPushReady(
    shouldPersist: () => boolean = () => true,
): Promise<PushBootstrapResult> {
    if (!vapidPublicKey) {
        return { status: 'unconfigured' };
    }

    if (!isPushSupported()) {
        return { status: 'unsupported' };
    }

    const registration = await registerServiceWorker();
    if (Notification.permission === 'denied') {
        return { status: 'denied' };
    }

    if (Notification.permission === 'default') {
        return { status: 'prompt' };
    }

    const result = await subscribeRegisteredWorker(registration, vapidPublicKey, shouldPersist);
    if (!result.ok) {
        throw new Error(`Push subscription failed: ${result.reason}`);
    }
    return { status: 'granted', endpoint: result.endpoint };
}

export async function requestWebPushPermission(
    shouldPersist: () => boolean = () => true,
): Promise<PushBootstrapResult> {
    if (!vapidPublicKey) {
        return { status: 'unconfigured' };
    }

    if (!isPushSupported()) {
        return { status: 'unsupported' };
    }

    const registration = await registerServiceWorker();
    if (Notification.permission === 'denied') {
        return { status: 'denied' };
    }

    const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permission !== 'granted') {
        return { status: permission === 'denied' ? 'denied' : 'prompt' };
    }

    const result = await subscribeRegisteredWorker(registration, vapidPublicKey, shouldPersist);
    if (!result.ok) {
        throw new Error(`Push subscription failed: ${result.reason}`);
    }
    return { status: 'granted', endpoint: result.endpoint };
}

export async function enablePushNotifications(): Promise<PushEnableResult> {
    const result = await requestWebPushPermission();
    if (result.status === 'granted' && result.endpoint) {
        return { ok: true, endpoint: result.endpoint };
    }
    if (result.status === 'denied') {
        return { ok: false, reason: 'denied' };
    }
    if (result.status === 'unconfigured' || result.status === 'unsupported') {
        return { ok: false, reason: result.status };
    }
    return { ok: false, reason: 'permission-dismissed' };
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

export async function detachCurrentPushSubscription(): Promise<void> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return;
    }

    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription?.endpoint) {
        return;
    }

    await notificationService.unsubscribePush(subscription.endpoint);
}
