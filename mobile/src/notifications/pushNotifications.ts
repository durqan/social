import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { PermissionsAndroid, Platform } from 'react-native';

import { notificationsApi } from '../api/notifications';
import { logDev, warnDev } from '../utils/logger';
import { navigateFromNotification } from './navigation';
import {
  normalizeNotificationData,
  type MobileNotificationData,
} from './types';
import {
  replaceMobilePushToken,
  type MobilePushTokenPayload,
} from './tokenRegistration';

export const MOBILE_NOTIFICATION_CHANNELS = {
  GENERAL: 'general',
  MESSAGES: 'messages',
  INCOMING_CALLS: 'incoming_calls',
} as const;

export type PushNotificationHandlers = {
  userId: number;
  onNotification?: (notification: MobileNotificationData) => void;
  onNotificationOpen?: (notification: MobileNotificationData) => void;
};

export type { MobilePushTokenPayload } from './tokenRegistration';

let activeRegisteredPayload: MobilePushTokenPayload | null = null;
let activePushUserId: number | null = null;
let pushSessionVersion = 0;
const pushBootstrapInFlight = new Map<string, Promise<boolean>>();
let androidPermissionRequestAttempted = false;

export type MobilePushSession = {
  key: string;
  isCurrent: () => boolean;
};

export function beginMobilePushSession(userId: number): MobilePushSession {
  if (activePushUserId !== userId) {
    activePushUserId = userId;
    pushSessionVersion += 1;
    pushBootstrapInFlight.clear();
  }
  const version = pushSessionVersion;
  return {
    key: `${userId}:${version}`,
    isCurrent: () =>
      activePushUserId === userId && pushSessionVersion === version,
  };
}

export function resetMobilePushSession() {
  const pendingBootstrap = Array.from(pushBootstrapInFlight.values());
  activePushUserId = null;
  pushSessionVersion += 1;
  pushBootstrapInFlight.clear();
  return Promise.allSettled(pendingBootstrap).then(() => undefined);
}

async function requestAndroidNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }

  if (
    await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    )
  ) {
    return true;
  }
  if (androidPermissionRequestAttempted) {
    return false;
  }

  androidPermissionRequestAttempted = true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function notificationFromRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage | null,
) {
  return normalizeNotificationData(remoteMessage?.data);
}

async function registerMobilePushToken(payload: MobilePushTokenPayload) {
  await notificationsApi.registerMobilePushToken(payload);
  logDev('[SocialMobile] FCM token ready for backend registration', {
    provider: payload.provider,
    platform: payload.platform,
    tokenPrefix: payload.token.slice(0, 8),
  });
}

async function revokeMobilePushToken(payload: MobilePushTokenPayload) {
  await notificationsApi.revokeMobilePushToken(payload);
  logDev('[SocialMobile] FCM token revoked', {
    provider: payload.provider,
    platform: payload.platform,
    tokenPrefix: payload.token.slice(0, 8),
  });
}

export function registerBackgroundMessageHandler() {
  try {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      logDev(
        '[SocialMobile] Background notification received',
        notificationFromRemoteMessage(remoteMessage),
      );
    });
  } catch (error) {
    warnDev('[SocialMobile] FCM background handler disabled', error);
  }
}

export function ensureMobilePushReady(
  session: MobilePushSession,
): Promise<boolean> {
  const existing = pushBootstrapInFlight.get(session.key);
  if (existing) {
    return existing;
  }

  const bootstrap = ensureMobilePushReadyInternal(session).finally(() => {
    if (pushBootstrapInFlight.get(session.key) === bootstrap) {
      pushBootstrapInFlight.delete(session.key);
    }
  });
  pushBootstrapInFlight.set(session.key, bootstrap);
  return bootstrap;
}

async function ensureMobilePushReadyInternal(session: MobilePushSession) {
  if (Platform.OS !== 'android') {
    return false;
  }

  const permissionGranted = await requestAndroidNotificationPermission();
  if (!permissionGranted) {
    return false;
  }

  await messaging().registerDeviceForRemoteMessages();

  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;
  if (!enabled) {
    return false;
  }

  const token = await messaging().getToken();
  if (!token || !session.isCurrent()) {
    return false;
  }

  const payload: MobilePushTokenPayload = {
    provider: 'fcm',
    platform: 'android',
    token,
  };
  await registerMobilePushToken(payload);
  if (!session.isCurrent()) {
    await revokeMobilePushToken(payload).catch(error => {
      warnDev('[SocialMobile] superseded FCM token revoke failed', error);
    });
    return false;
  }
  activeRegisteredPayload = payload;
  return true;
}

export async function initializePushNotifications({
  userId,
  onNotification,
  onNotificationOpen,
}: PushNotificationHandlers) {
  const cleanup: Array<() => void> = [];
  const session = beginMobilePushSession(userId);

  try {
    if (!(await ensureMobilePushReady(session))) {
      return () => undefined;
    }

    cleanup.push(
      messaging().onTokenRefresh(nextToken => {
        if (!session.isCurrent()) {
          return;
        }
        const nextPayload: MobilePushTokenPayload = {
          provider: 'fcm',
          platform: 'android',
          token: nextToken,
        };
        const previousPayload = activeRegisteredPayload;
        replaceMobilePushToken(previousPayload, nextPayload, {
          register: payload => {
            if (!session.isCurrent()) {
              return Promise.reject(new Error('FCM session superseded'));
            }
            return registerMobilePushToken(payload);
          },
          revoke: payload =>
            revokeMobilePushToken(payload).catch(error => {
              warnDev(
                '[SocialMobile] previous FCM token revoke failed',
                error,
              );
            }),
        })
          .then(activePayload => {
            if (session.isCurrent()) {
              activeRegisteredPayload = activePayload;
            }
          })
          .catch(error => {
            warnDev(
              '[SocialMobile] FCM token refresh registration failed',
              error,
            );
          });
      }),
    );

    cleanup.push(
      messaging().onMessage(async remoteMessage => {
        const notification = notificationFromRemoteMessage(remoteMessage);
        onNotification?.(notification);
      }),
    );

    cleanup.push(
      messaging().onNotificationOpenedApp(remoteMessage => {
        const notification = notificationFromRemoteMessage(remoteMessage);
        onNotificationOpen?.(notification);
        navigateFromNotification(notification);
      }),
    );

    const initialNotification = await messaging().getInitialNotification();
    if (initialNotification) {
      const notification = notificationFromRemoteMessage(initialNotification);
      onNotificationOpen?.(notification);
      navigateFromNotification(notification);
    }
  } catch (error) {
    warnDev('[SocialMobile] FCM initialization skipped', error);
  }

  return () => {
    cleanup.forEach(dispose => dispose());
  };
}

export async function revokeRegisteredPushToken() {
  const payload = activeRegisteredPayload;
  activeRegisteredPayload = null;
  if (!payload) {
    return;
  }

  await revokeMobilePushToken(payload);
}
