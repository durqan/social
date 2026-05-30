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

export type PushNotificationHandlers = {
  onNotification?: (notification: MobileNotificationData) => void;
  onNotificationOpen?: (notification: MobileNotificationData) => void;
};

export type MobilePushTokenPayload = {
  provider: 'fcm';
  platform: 'android';
  token: string;
};

let activeRegisteredPayload: MobilePushTokenPayload | null = null;

async function requestAndroidNotificationPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) {
    return true;
  }

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

export async function initializePushNotifications({
  onNotification,
  onNotificationOpen,
}: PushNotificationHandlers) {
  const cleanup: Array<() => void> = [];
  let registeredPayload: MobilePushTokenPayload | null = null;

  try {
    const permissionGranted = await requestAndroidNotificationPermission();
    if (!permissionGranted) {
      return () => undefined;
    }

    await messaging().registerDeviceForRemoteMessages();

    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      return () => undefined;
    }

    const token = await messaging().getToken();
    if (token) {
      registeredPayload = {
        provider: 'fcm',
        platform: 'android',
        token,
      };
      activeRegisteredPayload = registeredPayload;
      await registerMobilePushToken(registeredPayload);
    }

    cleanup.push(
      messaging().onTokenRefresh(nextToken => {
        const nextPayload: MobilePushTokenPayload = {
          provider: 'fcm',
          platform: 'android',
          token: nextToken,
        };
        registeredPayload = nextPayload;
        activeRegisteredPayload = nextPayload;
        registerMobilePushToken(nextPayload).catch(error => {
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
    if (registeredPayload) {
      revokeRegisteredPushToken().catch(error => {
        warnDev('[SocialMobile] FCM token cleanup failed', error);
      });
    }
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
