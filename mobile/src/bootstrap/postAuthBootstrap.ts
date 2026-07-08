import {
  beginMobilePushSession,
  ensureMobilePushReady,
  resetMobilePushSession,
} from '../notifications/pushNotifications';
import { warnDev } from '../utils/logger';

type E2EEBootstrapStatus = 'idle' | 'ready' | 'needs-secret' | 'error';

const bootstrapInFlight = new Map<number, Promise<void>>();
let activeUserId: number | null = null;
let bootstrapVersion = 0;

function activateUser(userId: number) {
  if (activeUserId !== userId) {
    activeUserId = userId;
    bootstrapVersion += 1;
    bootstrapInFlight.clear();
  }
  return bootstrapVersion;
}

function isCurrent(userId: number, version: number) {
  return activeUserId === userId && bootstrapVersion === version;
}

export function resetPostAuthBootstrap() {
  activeUserId = null;
  bootstrapVersion += 1;
  bootstrapInFlight.clear();
  return resetMobilePushSession();
}

export function runPostAuthBootstrap(userId: number): Promise<void> {
  const version = activateUser(userId);
  const existing = bootstrapInFlight.get(userId);
  if (existing) {
    return existing;
  }

  const bootstrap = createPostAuthBootstrap(userId, version);
  bootstrapInFlight.set(userId, bootstrap);
  return bootstrap;
}

export async function ensureE2EEReady(
  userId: number,
  secret?: string,
): Promise<E2EEBootstrapStatus> {
  try {
    const [
      { e2eeApi },
      { getLocalE2EEKeyBundle },
      { createEncryptedMasterKeyBackup, enableE2EEForUser, restoreE2EEFromBackup },
    ] = await Promise.all([
      import('../api/e2ee'),
      import('../crypto/masterKey'),
      import('../crypto/keyBackup'),
    ]);
    const [backup, localKey] = await Promise.all([
      e2eeApi.getBackup(),
      getLocalE2EEKeyBundle(userId),
    ]);

    if (backup.enabled && localKey) {
      return 'ready';
    }
    if (!secret) {
      return backup.enabled ? 'needs-secret' : 'idle';
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
      await e2eeApi.enable(encryptedBackup);
    }

    return 'ready';
  } catch (error) {
    warnDev('[SocialMobile] E2EE bootstrap failed', error);
    return 'error';
  }
}

function createPostAuthBootstrap(
  userId: number,
  version: number,
) {
  const bootstrap = Promise.resolve()
    .then<PromiseSettledResult<unknown>[]>(() => {
      if (!isCurrent(userId, version)) {
        return [];
      }
      const pushSession = beginMobilePushSession(userId);
      return Promise.allSettled([
        ensureMobilePushReady(pushSession),
      ]);
    })
    .then(results => {
      results.forEach(result => {
        if (result.status === 'rejected') {
          warnDev('[SocialMobile] post-auth bootstrap step failed', result.reason);
        }
      });
    })
    .finally(() => {
      if (bootstrapInFlight.get(userId) === bootstrap) {
        bootstrapInFlight.delete(userId);
      }
    });
  return bootstrap;
}
