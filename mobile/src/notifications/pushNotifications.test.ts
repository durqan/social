const mockMessagingInstance = {
  registerDeviceForRemoteMessages: jest.fn(),
  requestPermission: jest.fn(),
  getToken: jest.fn(),
  onTokenRefresh: jest.fn(),
  onMessage: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  getInitialNotification: jest.fn(),
  setBackgroundMessageHandler: jest.fn(),
};

type MockMessaging = jest.MockedFunction<() => typeof mockMessagingInstance> & {
  AuthorizationStatus: {
    AUTHORIZED: number;
    PROVISIONAL: number;
  };
};

const mockMessaging = jest.fn(() => mockMessagingInstance) as unknown as MockMessaging;
mockMessaging.AuthorizationStatus = {
  AUTHORIZED: 1,
  PROVISIONAL: 2,
};

const mockPermissionsAndroid = {
  PERMISSIONS: {
    POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
  },
  check: jest.fn(),
  request: jest.fn(),
};

const mockNotificationsApi = {
  registerMobilePushToken: jest.fn(),
  revokeMobilePushToken: jest.fn(),
};
const mockLocalNotificationCleanup = jest.fn();
const mockLocalNotifications = {
  MOBILE_NOTIFICATION_CHANNELS: {
    GENERAL: 'general',
    MESSAGES: 'messages',
    INCOMING_CALLS: 'incoming_calls',
  },
  displayForegroundNotification: jest.fn(),
  openLocalNotificationSettings: jest.fn(),
  registerLocalNotificationBackgroundHandler: jest.fn(),
  registerLocalNotificationOpenHandlers: jest.fn(),
};
const mockPushEffects = {
  applyPushNotificationEffects: jest.fn(),
  enqueuePendingPushEvent: jest.fn(),
};

function mockNumberFromValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

jest.mock('@react-native-firebase/messaging', () => mockMessaging);
jest.mock('@social/shared', () => ({
  normalizeNotificationData: jest.fn(data => ({
    type: data?.type ?? 'system',
    actorId: mockNumberFromValue(data?.actor_id ?? data?.actorId),
    senderId: mockNumberFromValue(data?.sender_id ?? data?.senderId),
    conversationId: mockNumberFromValue(data?.conversation_id ?? data?.conversationId),
    callId: data?.call_id ?? data?.callId,
    syncAction: data?.sync_action ?? data?.syncAction,
    url: data?.url,
  })),
}), { virtual: true });
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    Version: 33,
    select: (values: Record<string, unknown>) => values.android ?? values.default,
  },
  PermissionsAndroid: mockPermissionsAndroid,
}));
jest.mock('./navigation', () => ({
  navigateFromNotification: jest.fn(),
}));
jest.mock('../api/notifications', () => ({
  notificationsApi: mockNotificationsApi,
}));
jest.mock('./localNotifications', () => mockLocalNotifications);
jest.mock('./pushEffects', () => mockPushEffects);
jest.mock('../utils/logger', () => ({
  logDev: jest.fn(),
  warnDev: jest.fn(),
}));

describe('mobile push notifications', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPermissionsAndroid.check.mockResolvedValue(true);
    mockPermissionsAndroid.request.mockResolvedValue(
      mockPermissionsAndroid.RESULTS.GRANTED,
    );
    mockMessagingInstance.registerDeviceForRemoteMessages.mockResolvedValue(undefined);
    mockMessagingInstance.requestPermission.mockResolvedValue(
      mockMessaging.AuthorizationStatus.AUTHORIZED,
    );
    mockMessagingInstance.getToken.mockResolvedValue('fcm-token');
    mockMessagingInstance.onTokenRefresh.mockReturnValue(jest.fn());
    mockMessagingInstance.onMessage.mockReturnValue(jest.fn());
    mockMessagingInstance.onNotificationOpenedApp.mockReturnValue(jest.fn());
    mockMessagingInstance.getInitialNotification.mockResolvedValue(null);
    mockNotificationsApi.registerMobilePushToken.mockResolvedValue({ status: 'registered' });
    mockNotificationsApi.revokeMobilePushToken.mockResolvedValue({ status: 'revoked' });
    mockLocalNotifications.displayForegroundNotification.mockResolvedValue(true);
    mockLocalNotifications.openLocalNotificationSettings.mockResolvedValue(undefined);
    mockLocalNotifications.registerLocalNotificationOpenHandlers.mockReturnValue(
      mockLocalNotificationCleanup,
    );
    mockPushEffects.enqueuePendingPushEvent.mockResolvedValue(null);
  });

  it('registers FCM token for the current session', async () => {
    const { beginMobilePushSession, ensureMobilePushReady } = require('./pushNotifications');

    await expect(
      ensureMobilePushReady(beginMobilePushSession(10)),
    ).resolves.toBe(true);

    expect(mockNotificationsApi.registerMobilePushToken).toHaveBeenCalledWith({
      provider: 'fcm',
      platform: 'android',
      token: 'fcm-token',
    });
  });

  it('permission denied does not crash or register token', async () => {
    mockPermissionsAndroid.check.mockResolvedValue(false);
    mockPermissionsAndroid.request.mockResolvedValue(
      mockPermissionsAndroid.RESULTS.DENIED,
    );

    const { beginMobilePushSession, ensureMobilePushReady } = require('./pushNotifications');

    await expect(
      ensureMobilePushReady(beginMobilePushSession(11)),
    ).resolves.toBe(false);

    expect(mockNotificationsApi.registerMobilePushToken).not.toHaveBeenCalled();
  });

  it('registers opened and initial handlers when token bootstrap is denied', async () => {
    mockPermissionsAndroid.check.mockResolvedValue(false);
    mockPermissionsAndroid.request.mockResolvedValue(
      mockPermissionsAndroid.RESULTS.DENIED,
    );

    const { initializePushNotifications } = require('./pushNotifications');

    await initializePushNotifications({
      userId: 13,
      onNotification: jest.fn(),
      onNotificationOpen: jest.fn(),
    });

    expect(mockMessagingInstance.onNotificationOpenedApp).toHaveBeenCalledTimes(1);
    expect(mockMessagingInstance.getInitialNotification).toHaveBeenCalledTimes(1);
    expect(mockMessagingInstance.onMessage).toHaveBeenCalledTimes(1);
    expect(
      mockLocalNotifications.registerLocalNotificationOpenHandlers,
    ).toHaveBeenCalledTimes(1);
    expect(mockNotificationsApi.registerMobilePushToken).not.toHaveBeenCalled();
  });

  it('foreground message calls local notification helper', async () => {
    let foregroundHandler: ((message: unknown) => Promise<void>) | undefined;
    mockMessagingInstance.onMessage.mockImplementation(handler => {
      foregroundHandler = handler;
      return jest.fn();
    });

    const { initializePushNotifications } = require('./pushNotifications');
    await initializePushNotifications({
      userId: 14,
      onNotification: jest.fn(),
      onNotificationOpen: jest.fn(),
    });

    await foregroundHandler?.({
      data: {
        type: 'message_received',
        conversation_id: '42',
      },
      notification: {
        title: 'Alice',
        body: 'Hello',
      },
    });

    expect(mockLocalNotifications.displayForegroundNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message_received',
        conversationId: 42,
        title: 'Alice',
        body: 'Hello',
      }),
    );
  });

  it('background notification sync is stored as a pending push event', async () => {
    let backgroundHandler: ((message: unknown) => Promise<void>) | undefined;
    mockMessagingInstance.setBackgroundMessageHandler.mockImplementation(handler => {
      backgroundHandler = handler;
    });

    const { registerBackgroundMessageHandler } = require('./pushNotifications');
    registerBackgroundMessageHandler();

    await backgroundHandler?.({
      data: {
        type: 'notification_sync',
        sync_action: 'message_read',
        conversation_id: '42',
      },
    });

    expect(mockPushEffects.enqueuePendingPushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification_sync',
        syncAction: 'message_read',
        conversationId: 42,
      }),
    );
  });

  it('logout revokes the active registered token', async () => {
    const { beginMobilePushSession, ensureMobilePushReady, revokeRegisteredPushToken } = require('./pushNotifications');

    await ensureMobilePushReady(beginMobilePushSession(12));
    await revokeRegisteredPushToken();

    expect(mockNotificationsApi.revokeMobilePushToken).toHaveBeenCalledWith({
      provider: 'fcm',
      platform: 'android',
      token: 'fcm-token',
    });
  });
});
