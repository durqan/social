import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getBackup: vi.fn(),
    enable: vi.fn(),
    getLocalBundle: vi.fn(),
    createLocalBundle: vi.fn(),
    createEncryptedBackup: vi.fn(),
    getBackupPublicKey: vi.fn(),
    restoreBackup: vi.fn(),
    ensureWebPushReady: vi.fn(),
    requestWebPushPermission: vi.fn(),
}));

vi.mock('@/shared/api/e2eeService.js', () => ({
    e2eeService: {
        getBackup: mocks.getBackup,
        enable: mocks.enable,
    },
}));

vi.mock('@/crypto/masterKey.js', () => ({
    getLocalE2EEKeyBundle: mocks.getLocalBundle,
    createLocalE2EEKeyBundle: mocks.createLocalBundle,
}));

vi.mock('@/crypto/keyBackup.js', () => ({
    createEncryptedMasterKeyBackup: mocks.createEncryptedBackup,
    getE2EEBackupPublicKey: mocks.getBackupPublicKey,
    restoreE2EEFromBackup: mocks.restoreBackup,
}));

vi.mock('@/features/notifications/api/pushNotifications.js', () => ({
    ensureWebPushReady: mocks.ensureWebPushReady,
    requestWebPushPermission: mocks.requestWebPushPermission,
}));

describe('ensureE2EEReady', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.ensureWebPushReady.mockResolvedValue({ status: 'unsupported' });
    });

    it('shares one in-flight initialization and does not create duplicate keys or backups', async () => {
        const bundle = { publicKeyBase64: 'new-public-key' };
        mocks.getBackup.mockResolvedValue({
            enabled: false,
            encrypted_master_key: null,
        });
        mocks.getLocalBundle.mockResolvedValue(null);
        mocks.createLocalBundle.mockResolvedValue(bundle);
        mocks.createEncryptedBackup.mockResolvedValue('encrypted-backup');
        mocks.enable.mockResolvedValue(undefined);

        const { ensureE2EEReady } = await import('./postAuthBootstrap.js');
        const [first, second] = await Promise.all([
            ensureE2EEReady(10, 'secret'),
            ensureE2EEReady(10, 'secret'),
        ]);

        expect(first).toBe('ready');
        expect(second).toBe('ready');
        expect(mocks.createLocalBundle).toHaveBeenCalledTimes(1);
        expect(mocks.createEncryptedBackup).toHaveBeenCalledTimes(1);
        expect(mocks.enable).toHaveBeenCalledTimes(1);
    });

    it('does not replace an existing server key when the local key is missing and no secret is available', async () => {
        mocks.getBackup.mockResolvedValue({
            enabled: true,
            encrypted_master_key: 'encrypted-backup',
        });
        mocks.getLocalBundle.mockResolvedValue(null);
        mocks.getBackupPublicKey.mockReturnValue('existing-public-key');

        const { ensureE2EEReady } = await import('./postAuthBootstrap.js');
        await expect(ensureE2EEReady(11)).resolves.toBe('needs-secret');

        expect(mocks.createLocalBundle).not.toHaveBeenCalled();
        expect(mocks.restoreBackup).not.toHaveBeenCalled();
        expect(mocks.enable).not.toHaveBeenCalled();
    });

    it('reuses a matching local bundle after refresh without generating or uploading keys', async () => {
        const bundle = { publicKeyBase64: 'existing-public-key' };
        mocks.getBackup.mockResolvedValue({
            enabled: true,
            encrypted_master_key: 'encrypted-backup',
        });
        mocks.getLocalBundle.mockResolvedValue(bundle);
        mocks.getBackupPublicKey.mockReturnValue(bundle.publicKeyBase64);

        const { ensureE2EEReady } = await import('./postAuthBootstrap.js');
        await expect(ensureE2EEReady(12)).resolves.toBe('ready');

        expect(mocks.createLocalBundle).not.toHaveBeenCalled();
        expect(mocks.restoreBackup).not.toHaveBeenCalled();
        expect(mocks.enable).not.toHaveBeenCalled();
    });

    it('restores an existing backup only when the login secret is provided', async () => {
        mocks.getBackup.mockResolvedValue({
            enabled: true,
            encrypted_master_key: 'encrypted-backup',
        });
        mocks.getLocalBundle.mockResolvedValue(null);
        mocks.getBackupPublicKey.mockReturnValue('existing-public-key');
        mocks.restoreBackup.mockResolvedValue({ publicKeyBase64: 'existing-public-key' });

        const { ensureE2EEReady } = await import('./postAuthBootstrap.js');
        await expect(ensureE2EEReady(13, 'secret')).resolves.toBe('ready');

        expect(mocks.restoreBackup).toHaveBeenCalledWith(13, 'secret', 'encrypted-backup');
        expect(mocks.createLocalBundle).not.toHaveBeenCalled();
        expect(mocks.enable).not.toHaveBeenCalled();
    });

    it('fails closed on a local/server public key conflict', async () => {
        mocks.getBackup.mockResolvedValue({
            enabled: true,
            encrypted_master_key: 'encrypted-backup',
        });
        mocks.getLocalBundle.mockResolvedValue({ publicKeyBase64: 'local-key' });
        mocks.getBackupPublicKey.mockReturnValue('server-key');

        const { ensureE2EEReady, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');
        await expect(ensureE2EEReady(14, 'secret')).rejects.toThrow('does not match');

        expect(mocks.restoreBackup).not.toHaveBeenCalled();
        expect(mocks.createLocalBundle).not.toHaveBeenCalled();
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(getPostAuthBootstrapState().e2ee.status).toBe('error');
    });

    it('keeps the app bootstrap resolved while exposing an E2EE network error in state', async () => {
        mocks.getBackup.mockRejectedValue(new Error('network unavailable'));
        mocks.getLocalBundle.mockResolvedValue(null);

        const { runPostAuthBootstrap, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');
        await expect(runPostAuthBootstrap(15, { e2eeSecret: 'secret' })).resolves.toBeUndefined();

        expect(getPostAuthBootstrapState()).toMatchObject({
            userId: 15,
            e2ee: {
                status: 'error',
                error: 'network unavailable',
            },
        });
    });

    it('reuses the generated local bundle after a backup upload network failure', async () => {
        const bundle = { publicKeyBase64: 'stable-local-key' };
        mocks.getBackup.mockResolvedValue({
            enabled: false,
            encrypted_master_key: null,
        });
        mocks.getLocalBundle
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(bundle);
        mocks.createLocalBundle.mockResolvedValue(bundle);
        mocks.createEncryptedBackup.mockResolvedValue('encrypted-backup');
        mocks.enable
            .mockRejectedValueOnce(new Error('upload failed'))
            .mockResolvedValueOnce(undefined);

        const { ensureE2EEReady } = await import('./postAuthBootstrap.js');
        await expect(ensureE2EEReady(19, 'secret')).rejects.toThrow('upload failed');
        await expect(ensureE2EEReady(19, 'secret')).resolves.toBe('ready');

        expect(mocks.createLocalBundle).toHaveBeenCalledTimes(1);
        expect(mocks.createEncryptedBackup).toHaveBeenCalledTimes(2);
        expect(mocks.enable).toHaveBeenCalledTimes(2);
    });

    it('does not lose a login secret when a session-restore bootstrap is already running', async () => {
        let resolveFirstBackup!: (value: {
            enabled: boolean;
            encrypted_master_key: string;
        }) => void;
        const firstBackup = new Promise<{
            enabled: boolean;
            encrypted_master_key: string;
        }>(resolve => {
            resolveFirstBackup = resolve;
        });
        mocks.getBackup
            .mockReturnValueOnce(firstBackup)
            .mockResolvedValue({
                enabled: true,
                encrypted_master_key: 'encrypted-backup',
            });
        mocks.getLocalBundle.mockResolvedValue(null);
        mocks.getBackupPublicKey.mockReturnValue('existing-public-key');
        mocks.restoreBackup.mockResolvedValue({ publicKeyBase64: 'existing-public-key' });

        const { runPostAuthBootstrap } = await import('./postAuthBootstrap.js');
        const sessionRestore = runPostAuthBootstrap(16);
        const loginBootstrap = runPostAuthBootstrap(16, { e2eeSecret: 'secret' });
        resolveFirstBackup({
            enabled: true,
            encrypted_master_key: 'encrypted-backup',
        });

        await Promise.all([sessionRestore, loginBootstrap]);
        expect(mocks.restoreBackup).toHaveBeenCalledWith(16, 'secret', 'encrypted-backup');
        expect(mocks.restoreBackup).toHaveBeenCalledTimes(1);
    });

    it('ignores completion state from a previous user after account switch', async () => {
        let resolveOldBackup!: (value: {
            enabled: boolean;
            encrypted_master_key: string | null;
        }) => void;
        const oldBackup = new Promise<{
            enabled: boolean;
            encrypted_master_key: string | null;
        }>(resolve => {
            resolveOldBackup = resolve;
        });
        mocks.getBackup
            .mockReturnValueOnce(oldBackup)
            .mockResolvedValueOnce({
                enabled: false,
                encrypted_master_key: null,
            });
        mocks.getLocalBundle
            .mockResolvedValueOnce({ publicKeyBase64: 'old-key' })
            .mockResolvedValueOnce({ publicKeyBase64: 'new-key' });

        const { ensureE2EEReady, getPostAuthBootstrapState } = await import('./postAuthBootstrap.js');
        const oldUserBootstrap = ensureE2EEReady(17);
        await expect(ensureE2EEReady(18)).resolves.toBe('needs-secret');
        resolveOldBackup({
            enabled: false,
            encrypted_master_key: null,
        });
        await expect(oldUserBootstrap).rejects.toThrow('superseded');

        expect(getPostAuthBootstrapState()).toMatchObject({
            userId: 18,
            e2ee: {
                status: 'needs-secret',
            },
        });
    });
});
