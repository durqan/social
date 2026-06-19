import {
    createEncryptedMasterKeyBackup,
    getE2EEBackupPublicKey,
    restoreE2EEFromBackup,
} from "@/crypto/keyBackup.js";
import {
    createLocalE2EEKeyBundle,
    getLocalE2EEKeyBundle,
} from "@/crypto/masterKey.js";
import {
    ensureWebPushReady,
    requestWebPushPermission,
    type PushNotificationStatus,
} from "@/features/notifications/api/pushNotifications.js";
import { e2eeService } from "@/shared/api/e2eeService.js";

export type E2EEBootstrapStatus = 'idle' | 'checking' | 'ready' | 'needs-secret' | 'error';
export type WebPushBootstrapStatus = PushNotificationStatus | 'checking' | 'error';

export type PostAuthBootstrapState = {
    userId: number | null;
    e2ee: {
        status: E2EEBootstrapStatus;
        error: string | null;
    };
    webPush: {
        status: WebPushBootstrapStatus;
        error: string | null;
    };
};

type BootstrapOptions = {
    e2eeSecret?: string;
};

const initialState: PostAuthBootstrapState = {
    userId: null,
    e2ee: {
        status: 'idle',
        error: null,
    },
    webPush: {
        status: 'unconfigured',
        error: null,
    },
};

let state = initialState;
let stateVersion = 0;
const listeners = new Set<() => void>();
const e2eeInFlight = new Map<number, Promise<E2EEBootstrapStatus>>();
const pushInFlight = new Map<number, Promise<WebPushBootstrapStatus>>();
const bootstrapInFlight = new Map<number, {
    promise: Promise<void>;
    includesSecret: boolean;
}>();

function updateState(next: Partial<PostAuthBootstrapState>) {
    state = {
        ...state,
        ...next,
    };
    listeners.forEach(listener => listener());
}

function ensureStateUser(userId: number) {
    if (state.userId === userId) {
        return stateVersion;
    }
    stateVersion += 1;
    e2eeInFlight.clear();
    pushInFlight.clear();
    bootstrapInFlight.clear();
    updateState({
        ...initialState,
        userId,
    });
    return stateVersion;
}

function isCurrentBootstrap(userId: number, version: number) {
    return state.userId === userId && stateVersion === version;
}

function updateE2EE(
    userId: number,
    version: number,
    status: E2EEBootstrapStatus,
    error: string | null = null,
) {
    if (!isCurrentBootstrap(userId, version)) {
        return;
    }
    updateState({
        e2ee: {
            status,
            error,
        },
    });
}

function updateWebPush(
    userId: number,
    version: number,
    status: WebPushBootstrapStatus,
    error: string | null = null,
) {
    if (!isCurrentBootstrap(userId, version)) {
        return;
    }
    updateState({
        webPush: {
            status,
            error,
        },
    });
}

export function subscribePostAuthBootstrap(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getPostAuthBootstrapState() {
    return state;
}

export function resetPostAuthBootstrapState() {
    const pendingPush = Array.from(pushInFlight.values());
    stateVersion += 1;
    state = initialState;
    e2eeInFlight.clear();
    pushInFlight.clear();
    bootstrapInFlight.clear();
    listeners.forEach(listener => listener());
    return Promise.allSettled(pendingPush).then(() => undefined);
}

export function ensureE2EEReady(userId: number, secret?: string): Promise<E2EEBootstrapStatus> {
    const version = ensureStateUser(userId);
    const existing = e2eeInFlight.get(userId);
    if (existing) {
        if (secret) {
            return existing.then(status => (
                status === 'ready' ? status : ensureE2EEReady(userId, secret)
            ));
        }
        return existing;
    }

    updateE2EE(userId, version, 'checking');
    const bootstrap = ensureE2EEReadyInternal(userId, version, secret)
        .then(status => {
            updateE2EE(userId, version, status);
            return status;
        })
        .catch(error => {
            const message = error instanceof Error ? error.message : 'E2EE bootstrap failed';
            updateE2EE(userId, version, 'error', message);
            throw error;
        })
        .finally(() => {
            if (e2eeInFlight.get(userId) === bootstrap) {
                e2eeInFlight.delete(userId);
            }
        });

    e2eeInFlight.set(userId, bootstrap);
    return bootstrap;
}

async function ensureE2EEReadyInternal(
    userId: number,
    version: number,
    secret?: string,
): Promise<E2EEBootstrapStatus> {
    const [backup, existingBundle] = await Promise.all([
        e2eeService.getBackup(),
        getLocalE2EEKeyBundle(userId),
    ]);
    if (!isCurrentBootstrap(userId, version)) {
        throw new Error('E2EE bootstrap superseded by another session');
    }

    if (backup.enabled && backup.encrypted_master_key) {
        const backupPublicKey = getE2EEBackupPublicKey(backup.encrypted_master_key);

        if (existingBundle) {
            if (existingBundle.publicKeyBase64 !== backupPublicKey) {
                throw new Error('Local E2EE key does not match the encrypted server backup');
            }
            return 'ready';
        }

        if (!secret) {
            return 'needs-secret';
        }

        await restoreE2EEFromBackup(userId, secret, backup.encrypted_master_key);
        if (!isCurrentBootstrap(userId, version)) {
            throw new Error('E2EE bootstrap superseded by another session');
        }
        return 'ready';
    }

    const bundle = existingBundle ?? await createLocalE2EEKeyBundle(userId);
    if (!secret) {
        return 'needs-secret';
    }

    const encryptedBackup = await createEncryptedMasterKeyBackup(bundle, secret);
    if (!isCurrentBootstrap(userId, version)) {
        throw new Error('E2EE bootstrap superseded by another session');
    }
    await e2eeService.enable(encryptedBackup);
    return 'ready';
}

export function ensureWebPushForUser(userId: number): Promise<WebPushBootstrapStatus> {
    const version = ensureStateUser(userId);
    const existing = pushInFlight.get(userId);
    if (existing) {
        return existing;
    }

    updateWebPush(userId, version, 'checking');
    const bootstrap = ensureWebPushReady(() => isCurrentBootstrap(userId, version))
        .then(result => {
            updateWebPush(userId, version, result.status);
            return result.status;
        })
        .catch(error => {
            const message = error instanceof Error ? error.message : 'Web push bootstrap failed';
            updateWebPush(userId, version, 'error', message);
            throw error;
        })
        .finally(() => {
            if (pushInFlight.get(userId) === bootstrap) {
                pushInFlight.delete(userId);
            }
        });

    pushInFlight.set(userId, bootstrap);
    return bootstrap;
}

export async function requestAndEnableWebPush(userId: number): Promise<WebPushBootstrapStatus> {
    const version = ensureStateUser(userId);
    updateWebPush(userId, version, 'checking');
    try {
        const result = await requestWebPushPermission(() => isCurrentBootstrap(userId, version));
        updateWebPush(userId, version, result.status);
        return result.status;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Web push permission request failed';
        updateWebPush(userId, version, 'error', message);
        throw error;
    }
}

export function runPostAuthBootstrap(userId: number, options: BootstrapOptions = {}): Promise<void> {
    const version = ensureStateUser(userId);
    const existing = bootstrapInFlight.get(userId);
    if (existing) {
        if (options.e2eeSecret && !existing.includesSecret) {
            const escalated = createPostAuthBootstrap(userId, version, options, existing.promise);
            bootstrapInFlight.set(userId, escalated);
            return escalated.promise;
        }
        return existing.promise;
    }

    const bootstrap = createPostAuthBootstrap(userId, version, options);
    bootstrapInFlight.set(userId, bootstrap);
    return bootstrap.promise;
}

function createPostAuthBootstrap(
    userId: number,
    version: number,
    options: BootstrapOptions,
    waitFor?: Promise<void>,
) {
    const bootstrap = (waitFor ?? Promise.resolve())
        .then<PromiseSettledResult<unknown>[]>(() => {
            if (!isCurrentBootstrap(userId, version)) {
                return [];
            }
            return Promise.allSettled([
                ensureE2EEReady(userId, options.e2eeSecret),
                ensureWebPushForUser(userId),
            ]);
        })
        .then(() => undefined)
        .finally(() => {
            if (bootstrapInFlight.get(userId)?.promise === bootstrap) {
                bootstrapInFlight.delete(userId);
            }
        });

    return {
        promise: bootstrap,
        includesSecret: Boolean(options.e2eeSecret),
    };
}
