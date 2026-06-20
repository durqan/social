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

jest.mock('@react-native-firebase/messaging', () => mockMessaging);
jest.mock('@social/shared', () => ({
  normalizeNotificationData: jest.fn(data => data ?? {}),
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
    mockNotificationsApi.registerMobilePushToken.mockResolvedValue({ status: 'registered' });
    mockNotificationsApi.revokeMobilePushToken.mockResolvedValue({ status: 'revoked' });
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
