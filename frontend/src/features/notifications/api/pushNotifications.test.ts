import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationServiceMock = vi.hoisted(() => ({
    subscribePush: vi.fn(),
    unsubscribePush: vi.fn(),
}));

vi.mock('@/features/notifications/api/notificationService.js', () => ({
    notificationService: notificationServiceMock,
}));

function installPushGlobals(permission: NotificationPermission, existingSubscription: PushSubscription | null = null) {
    const subscription = existingSubscription ?? {
        endpoint: 'https://push.example/subscription',
        toJSON: () => ({
            endpoint: 'https://push.example/subscription',
            keys: {
                p256dh: 'p256dh',
                auth: 'auth',
            },
        }),
    } as unknown as PushSubscription;
    const pushManager = {
        getSubscription: vi.fn().mockResolvedValue(existingSubscription),
        subscribe: vi.fn().mockResolvedValue(subscription),
    };
    const registration = {
        update: vi.fn().mockResolvedValue(undefined),
        pushManager,
    } as unknown as ServiceWorkerRegistration;
    const requestPermission = vi.fn().mockResolvedValue(permission);

    const notificationApi = {
        permission,
        requestPermission,
    };
    vi.stubGlobal('window', {
        PushManager: function PushManager() {},
        Notification: notificationApi,
        atob,
        dispatchEvent: vi.fn(),
    });
    vi.stubGlobal('navigator', {
        serviceWorker: {
            register: vi.fn().mockResolvedValue(registration),
            ready: Promise.resolve(registration),
        },
    });
    vi.stubGlobal('Notification', notificationApi);

    return { pushManager, requestPermission };
}

describe('ensureWebPushReady', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQAB');
    });

    it.each(['default', 'denied'] as const)(
        'does not request browser permission automatically when permission is %s',
        async permission => {
            const { requestPermission } = installPushGlobals(permission);
            const { ensureWebPushReady } = await import('./pushNotifications.js');

            const result = await ensureWebPushReady();

            expect(result.status).toBe(permission === 'default' ? 'prompt' : 'denied');
            expect(requestPermission).not.toHaveBeenCalled();
            expect(notificationServiceMock.subscribePush).not.toHaveBeenCalled();
        },
    );

    it('registers and uploads a subscription when permission is already granted', async () => {
        const { pushManager, requestPermission } = installPushGlobals('granted');
        const { ensureWebPushReady } = await import('./pushNotifications.js');

        await expect(ensureWebPushReady()).resolves.toMatchObject({
            status: 'granted',
            endpoint: 'https://push.example/subscription',
        });
        expect(requestPermission).not.toHaveBeenCalled();
        expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
        expect(notificationServiceMock.subscribePush).toHaveBeenCalledWith({
            endpoint: 'https://push.example/subscription',
            keys: {
                p256dh: 'p256dh',
                auth: 'auth',
            },
        });
    });

    it('reuses an existing granted subscription without creating a duplicate', async () => {
        const existingSubscription = {
            endpoint: 'https://push.example/existing',
            toJSON: () => ({
                endpoint: 'https://push.example/existing',
                keys: {
                    p256dh: 'existing-p256dh',
                    auth: 'existing-auth',
                },
            }),
        } as unknown as PushSubscription;
        const { pushManager } = installPushGlobals('granted', existingSubscription);
        const { ensureWebPushReady } = await import('./pushNotifications.js');

        await expect(ensureWebPushReady()).resolves.toMatchObject({
            status: 'granted',
            endpoint: 'https://push.example/existing',
        });
        expect(pushManager.subscribe).not.toHaveBeenCalled();
        expect(notificationServiceMock.subscribePush).toHaveBeenCalledTimes(1);
    });

    it('requests permission only from the explicit user-action function', async () => {
        const { requestPermission } = installPushGlobals('default');
        requestPermission.mockResolvedValue('granted');
        const { requestWebPushPermission } = await import('./pushNotifications.js');

        await expect(requestWebPushPermission()).resolves.toMatchObject({
            status: 'granted',
        });
        expect(requestPermission).toHaveBeenCalledTimes(1);
        expect(notificationServiceMock.subscribePush).toHaveBeenCalledTimes(1);
    });

    it('does not persist a subscription after the auth session was superseded', async () => {
        installPushGlobals('granted');
        const { ensureWebPushReady } = await import('./pushNotifications.js');

        await expect(ensureWebPushReady(() => false)).rejects.toThrow('superseded');
        expect(notificationServiceMock.subscribePush).not.toHaveBeenCalled();
    });
});
