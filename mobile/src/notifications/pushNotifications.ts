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
  displayForegroundNotification,
  MOBILE_NOTIFICATION_CHANNELS,
  cancelIncomingCallNotification,
  openLocalNotificationSettings,
  registerLocalNotificationBackgroundHandler,
  registerLocalNotificationOpenHandlers,
} from './localNotifications';
import {
  applyPushNotificationEffects,
  enqueuePendingPushEvent,
} from './pushEffects';
import {
  replaceMobilePushToken,
  type MobilePushTokenPayload,
} from './tokenRegistration';
import { rememberTerminalIncomingCall } from './pendingIncomingCall';

export { MOBILE_NOTIFICATION_CHANNELS };

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
let androidPermissionLastRequestAt = 0;
let androidPermissionSettingsRequired = false;
let lastRegisteredTokenKey: string | null = null;
let activeNotificationListenersCleanup: (() => void) | null = null;

const androidPermissionRetryCooldownMs = 60_000;

export type MobilePushPermissionStatus =
  | 'granted'
  | 'prompt_available'
  | 'denied'
  | 'settings_required'
  | 'unsupported';

export type MobilePushSession = {
  key: string;
  userId: number;
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
    userId,
    isCurrent: () =>
      activePushUserId === userId && pushSessionVersion === version,
  };
}

export function resetMobilePushSession() {
  const pendingBootstrap = Array.from(pushBootstrapInFlight.values());
  activeNotificationListenersCleanup?.();
  activeNotificationListenersCleanup = null;
  activePushUserId = null;
  pushSessionVersion += 1;
  pushBootstrapInFlight.clear();
  return Promise.allSettled(pendingBootstrap).then(() => undefined);
}

async function checkAndroidNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }

  return PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
}

export async function getMobilePushPermissionStatus(): Promise<MobilePushPermissionStatus> {
  if (Platform.OS !== 'android') {
    return 'unsupported';
  }
  if (Platform.Version < 33) {
    return 'granted';
  }

  if (await checkAndroidNotificationPermission()) {
    androidPermissionSettingsRequired = false;
    return 'granted';
  }

  if (androidPermissionSettingsRequired) {
    return 'settings_required';
  }

  return androidPermissionRequestAttempted ? 'denied' : 'prompt_available';
}

export function openMobilePushNotificationSettings() {
  return openLocalNotificationSettings();
}

async function requestAndroidNotificationPermission(forcePrompt = false) {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }

  if (await checkAndroidNotificationPermission()) {
    androidPermissionSettingsRequired = false;
    androidPermissionRequestAttempted = false;
    return true;
  }

  const now = Date.now();
  const recentlyAttempted =
    androidPermissionRequestAttempted &&
    now - androidPermissionLastRequestAt < androidPermissionRetryCooldownMs;
  if (
    !forcePrompt &&
    (recentlyAttempted || androidPermissionSettingsRequired)
  ) {
    return false;
  }

  androidPermissionRequestAttempted = true;
  androidPermissionLastRequestAt = now;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
  );
  androidPermissionSettingsRequired =
    result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function requestMobilePushPermissionPrompt() {
  return requestAndroidNotificationPermission(true);
}

function notificationFromRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage | null,
) {
  return normalizeNotificationData({
    ...(remoteMessage?.data ?? {}),
    title: remoteMessage?.data?.title ?? remoteMessage?.notification?.title,
    body: remoteMessage?.data?.body ?? remoteMessage?.notification?.body,
    ts:
      remoteMessage?.data?.ts ??
      remoteMessage?.data?.timestamp ??
      remoteMessage?.sentTime,
  });
}

function isCallTerminalNotification(notification: MobileNotificationData) {
  return (
    notification.type === 'call_ended' ||
    notification.type === 'call_rejected' ||
    notification.type === 'call_missed'
  );
}

async function applyCallTerminalNotification(
  notification: MobileNotificationData,
) {
  if (!isCallTerminalNotification(notification)) {
    return;
  }
  await rememberTerminalIncomingCall(notification.callId).catch(error => {
    warnDev('[SocialMobile] stale call tombstone failed', error);
  });
  await cancelIncomingCallNotification(notification.callId).catch(error => {
    warnDev('[SocialMobile] stale call notification cancel failed', error);
  });
}

function mobileTokenKey(userId: number, payload: MobilePushTokenPayload) {
  return `${userId}:${payload.provider}:${payload.platform}:${payload.token}`;
}

async function registerMobilePushToken(
  userId: number,
  payload: MobilePushTokenPayload,
) {
  const nextKey = mobileTokenKey(userId, payload);
  if (lastRegisteredTokenKey === nextKey) {
    activeRegisteredPayload = payload;
    logDev('[SocialMobile] FCM token registration skipped', {
      reason: 'same_user_token',
      provider: payload.provider,
      platform: payload.platform,
      tokenPrefix: payload.token.slice(0, 8),
    });
    return;
  }

  await notificationsApi.registerMobilePushToken(payload);
  lastRegisteredTokenKey = nextKey;
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
    registerLocalNotificationBackgroundHandler();
  } catch (error) {
    warnDev(
      '[SocialMobile] local notification background handler disabled',
      error,
    );
  }

  try {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      const notification = notificationFromRemoteMessage(remoteMessage);
      await enqueuePendingPushEvent(notification);
      await applyCallTerminalNotification(notification);
      if (notification.type === 'incoming_call') {
        await displayForegroundNotification(notification).catch(error => {
          warnDev(
            '[SocialMobile] background incoming call notification skipped',
            error,
          );
        });
      }

      logDev('[SocialMobile] Background notification received', notification);
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
    // TODO: iOS APNs/FCM registration is intentionally out of scope for now.
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
  await registerMobilePushToken(session.userId, payload);
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
  activeNotificationListenersCleanup?.();
  activeNotificationListenersCleanup = null;
  let disposed = false;

  const handleNotificationOpen = (notification: MobileNotificationData) => {
    applyPushNotificationEffects(notification, {
      refreshNotifications: () => undefined,
      refreshUnreadCount: () => undefined,
      signalChatDataChanged: () => undefined,
    });
    onNotificationOpen?.(notification);
    navigateFromNotification(notification);
  };

  try {
    cleanup.push(
      messaging().onNotificationOpenedApp(remoteMessage => {
        handleNotificationOpen(notificationFromRemoteMessage(remoteMessage));
      }),
    );

    cleanup.push(registerLocalNotificationOpenHandlers(handleNotificationOpen));

    messaging()
      .getInitialNotification()
      .then(initialNotification => {
        if (initialNotification) {
          handleNotificationOpen(
            notificationFromRemoteMessage(initialNotification),
          );
        }
      })
      .catch(error => {
        warnDev('[SocialMobile] FCM initial notification unavailable', error);
      });
  } catch (error) {
    warnDev('[SocialMobile] FCM open handlers skipped', error);
  }

  try {
    cleanup.push(
      messaging().onMessage(async remoteMessage => {
        const notification = notificationFromRemoteMessage(remoteMessage);
        await enqueuePendingPushEvent(notification);
        await applyCallTerminalNotification(notification);
        onNotification?.(notification);
        if (!isCallTerminalNotification(notification)) {
          await displayForegroundNotification(notification).catch(error => {
            warnDev(
              '[SocialMobile] foreground local notification skipped',
              error,
            );
          });
        }
      }),
    );
  } catch (error) {
    warnDev('[SocialMobile] FCM foreground handler skipped', error);
  }

  const dispose = () => {
    disposed = true;
    cleanup.forEach(cleanupListener => cleanupListener());
    if (activeNotificationListenersCleanup === dispose) {
      activeNotificationListenersCleanup = null;
    }
  };
  activeNotificationListenersCleanup = dispose;

  try {
    const ready = await ensureMobilePushReady(session);
    if (!disposed && ready) {
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
              return registerMobilePushToken(userId, payload);
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
    }
  } catch (error) {
    warnDev('[SocialMobile] FCM initialization skipped', error);
  }

  return dispose;
}

export async function revokeRegisteredPushToken() {
  const payload = activeRegisteredPayload;
  activeRegisteredPayload = null;
  lastRegisteredTokenKey = null;
  if (!payload) {
    return;
  }

  await revokeMobilePushToken(payload);
}
