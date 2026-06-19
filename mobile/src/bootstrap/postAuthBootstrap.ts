import { e2eeApi } from '../api/e2ee';
import {
  createEncryptedMasterKeyBackup,
  getE2EEBackupPublicKey,
  restoreE2EEFromBackup,
} from '../crypto/keyBackup';
import {
  createLocalE2EEKeyBundle,
  getLocalE2EEKeyBundle,
} from '../crypto/masterKey';
import { isWebCryptoAvailable } from '../crypto/webCrypto';
import {
  beginMobilePushSession,
  ensureMobilePushReady,
  resetMobilePushSession,
} from '../notifications/pushNotifications';
import { warnDev } from '../utils/logger';

type BootstrapOptions = {
  e2eeSecret?: string;
};

const e2eeInFlight = new Map<number, Promise<void>>();
const bootstrapInFlight = new Map<number, {
  promise: Promise<void>;
  includesSecret: boolean;
}>();
let activeUserId: number | null = null;
let bootstrapVersion = 0;

function activateUser(userId: number) {
  if (activeUserId !== userId) {
    activeUserId = userId;
    bootstrapVersion += 1;
    e2eeInFlight.clear();
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
  e2eeInFlight.clear();
  bootstrapInFlight.clear();
  return resetMobilePushSession();
}

export function ensureE2EEReady(
  userId: number,
  version: number,
  secret?: string,
): Promise<void> {
  const existing = e2eeInFlight.get(userId);
  if (existing) {
    if (secret) {
      return existing.then(() => ensureE2EEReady(userId, version, secret));
    }
    return existing;
  }

  const bootstrap = ensureE2EEReadyInternal(userId, version, secret).finally(() => {
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
) {
  if (!isWebCryptoAvailable()) {
    throw new Error('WebCrypto is unavailable in this React Native runtime');
  }

  const [backup, existingBundle] = await Promise.all([
    e2eeApi.getBackup(),
    getLocalE2EEKeyBundle(userId),
  ]);
  if (!isCurrent(userId, version)) {
    throw new Error('E2EE bootstrap superseded by another session');
  }

  if (backup.enabled && backup.encrypted_master_key) {
    const backupPublicKey = getE2EEBackupPublicKey(
      backup.encrypted_master_key,
    );
    if (existingBundle) {
      if (existingBundle.publicKeyBase64 !== backupPublicKey) {
        throw new Error(
          'Local E2EE key does not match the encrypted server backup',
        );
      }
      return;
    }

    if (!secret) {
      return;
    }

    await restoreE2EEFromBackup(
      userId,
      secret,
      backup.encrypted_master_key,
    );
    if (!isCurrent(userId, version)) {
      throw new Error('E2EE bootstrap superseded by another session');
    }
    return;
  }

  const bundle =
    existingBundle ?? (await createLocalE2EEKeyBundle(userId));
  if (!secret) {
    return;
  }

  const encryptedBackup = await createEncryptedMasterKeyBackup(bundle, secret);
  if (!isCurrent(userId, version)) {
    throw new Error('E2EE bootstrap superseded by another session');
  }
  await e2eeApi.enable(encryptedBackup);
}

export function runPostAuthBootstrap(
  userId: number,
  options: BootstrapOptions = {},
): Promise<void> {
  const version = activateUser(userId);
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
      if (!isCurrent(userId, version)) {
        return [];
      }
      const pushSession = beginMobilePushSession(userId);
      return Promise.allSettled([
        ensureE2EEReady(userId, version, options.e2eeSecret),
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
      if (bootstrapInFlight.get(userId)?.promise === bootstrap) {
        bootstrapInFlight.delete(userId);
      }
    });

  return {
    promise: bootstrap,
    includesSecret: Boolean(options.e2eeSecret),
  };
}
