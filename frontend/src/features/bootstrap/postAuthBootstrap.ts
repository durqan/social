import {
    ensureWebPushReady,
    requestWebPushPermission,
    type PushNotificationStatus,
} from "@/features/notifications/api/pushNotifications.js";

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
const pushInFlight = new Map<number, Promise<WebPushBootstrapStatus>>();
const bootstrapInFlight = new Map<number, Promise<void>>();

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
    pushInFlight.clear();
    bootstrapInFlight.clear();
    listeners.forEach(listener => listener());
    return Promise.allSettled(pendingPush).then(() => undefined);
}

export async function ensureE2EEReady(userId: number, secret?: string): Promise<E2EEBootstrapStatus> {
    const version = ensureStateUser(userId);
    updateE2EE(userId, version, 'checking');

    try {
        const [
            { e2eeService },
            { getLocalE2EEKeyBundle },
            { createEncryptedMasterKeyBackup, enableE2EEForUser, restoreE2EEFromBackup },
        ] = await Promise.all([
            import("@/shared/api/e2eeService.js"),
            import("@/crypto/masterKey.js"),
            import("@/crypto/keyBackup.js"),
        ]);
        const [backup, localKey] = await Promise.all([
            e2eeService.getBackup(),
            getLocalE2EEKeyBundle(userId),
        ]);

        if (!isCurrentBootstrap(userId, version)) {
            return state.e2ee.status;
        }

        if (backup.enabled && localKey) {
            updateE2EE(userId, version, 'ready');
            return 'ready';
        }
        if (!secret) {
            const status = backup.enabled ? 'needs-secret' : 'idle';
            updateE2EE(userId, version, status);
            return status;
        }

        if (backup.enabled) {
            if (!backup.encrypted_master_key) {
                throw new Error('E2EE backup is missing');
            }
            await restoreE2EEFromBackup(userId, secret, backup.encrypted_master_key);
        } else {
            const encryptedBackup = localKey
                ? await createEncryptedMasterKeyBackup(localKey, secret)
                : await enableE2EEForUser(userId, secret);
            await e2eeService.enable(encryptedBackup);
        }

        updateE2EE(userId, version, 'ready');
        return 'ready';
    } catch (error) {
        const message = error instanceof Error ? error.message : 'E2EE bootstrap failed';
        updateE2EE(userId, version, 'error', message);
        throw error;
    }
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

export function runPostAuthBootstrap(userId: number): Promise<void> {
    const version = ensureStateUser(userId);
    const existing = bootstrapInFlight.get(userId);
    if (existing) {
        return existing;
    }

    const bootstrap = createPostAuthBootstrap(userId, version);
    bootstrapInFlight.set(userId, bootstrap);
    return bootstrap;
}

function createPostAuthBootstrap(
    userId: number,
    version: number,
) {
    const bootstrap = Promise.resolve()
        .then<PromiseSettledResult<unknown>[]>(() => {
            if (!isCurrentBootstrap(userId, version)) {
                return [];
            }
            return Promise.allSettled([
                ensureWebPushForUser(userId),
            ]);
        })
        .then(() => undefined)
        .finally(() => {
            if (bootstrapInFlight.get(userId) === bootstrap) {
                bootstrapInFlight.delete(userId);
            }
        });

    return bootstrap;
}
