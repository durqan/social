import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    ensureWebPushReady: vi.fn(),
    requestWebPushPermission: vi.fn(),
    getE2EEBackup: vi.fn(),
    enableE2EEService: vi.fn(),
    getLocalE2EEKeyBundle: vi.fn(),
    enableE2EEForUser: vi.fn(),
    createEncryptedMasterKeyBackup: vi.fn(),
    restoreE2EEFromBackup: vi.fn(),
}));

vi.mock('@/features/notifications/api/pushNotifications.js', () => ({
    ensureWebPushReady: mocks.ensureWebPushReady,
    requestWebPushPermission: mocks.requestWebPushPermission,
}));

vi.mock('@/shared/api/e2eeService.js', () => ({
    e2eeService: {
        getBackup: mocks.getE2EEBackup,
        enable: mocks.enableE2EEService,
    },
}));

vi.mock('@/crypto/masterKey.js', () => ({
    getLocalE2EEKeyBundle: mocks.getLocalE2EEKeyBundle,
}));

vi.mock('@/crypto/keyBackup.js', () => ({
    enableE2EEForUser: mocks.enableE2EEForUser,
    createEncryptedMasterKeyBackup: mocks.createEncryptedMasterKeyBackup,
    restoreE2EEFromBackup: mocks.restoreE2EEFromBackup,
}));

describe('post auth bootstrap', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.ensureWebPushReady.mockResolvedValue({ status: 'unsupported' });
        mocks.requestWebPushPermission.mockResolvedValue({ status: 'granted' });
        mocks.getE2EEBackup.mockResolvedValue({ enabled: false, encrypted_master_key: null });
        mocks.getLocalE2EEKeyBundle.mockResolvedValue(null);
    });

    it('keeps E2EE bootstrap idle when no backup exists', async () => {
        const { ensureE2EEReady, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');

        await expect(ensureE2EEReady(10)).resolves.toBe('idle');
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
