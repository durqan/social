import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    ensureWebPushReady: vi.fn(),
    requestWebPushPermission: vi.fn(),
}));

vi.mock('@/features/notifications/api/pushNotifications.js', () => ({
    ensureWebPushReady: mocks.ensureWebPushReady,
    requestWebPushPermission: mocks.requestWebPushPermission,
}));

describe('post auth bootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.ensureWebPushReady.mockResolvedValue({ status: 'unsupported' });
        mocks.requestWebPushPermission.mockResolvedValue({ status: 'granted' });
    });

    it('keeps E2EE bootstrap disabled', async () => {
        const { ensureE2EEReady, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');

        await expect(ensureE2EEReady(10, 'ignored')).resolves.toBe('idle');
        expect(getPostAuthBootstrapState()).toMatchObject({
            userId: 10,
            e2ee: {
                status: 'idle',
                error: null,
            },
        });
    });

    it('runs web push bootstrap after auth', async () => {
        const { runPostAuthBootstrap, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');

        await expect(runPostAuthBootstrap(11)).resolves.toBeUndefined();

        expect(mocks.ensureWebPushReady).toHaveBeenCalledTimes(1);
        expect(getPostAuthBootstrapState()).toMatchObject({
            userId: 11,
            webPush: {
                status: 'unsupported',
                error: null,
            },
        });
    });

    it('shares one in-flight push bootstrap for the same user', async () => {
        const { runPostAuthBootstrap } = await import('./postAuthBootstrap.js');

        await Promise.all([
            runPostAuthBootstrap(12),
            runPostAuthBootstrap(12),
        ]);

        expect(mocks.ensureWebPushReady).toHaveBeenCalledTimes(1);
    });
});
