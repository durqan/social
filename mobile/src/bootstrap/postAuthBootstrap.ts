import {
  beginMobilePushSession,
  ensureMobilePushReady,
  resetMobilePushSession,
} from '../notifications/pushNotifications';
import { warnDev } from '../utils/logger';

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
