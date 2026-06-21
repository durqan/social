const mockNotifee = {
  createChannel: jest.fn(),
  displayNotification: jest.fn(),
  getInitialNotification: jest.fn(),
  onBackgroundEvent: jest.fn(),
  onForegroundEvent: jest.fn(),
  openNotificationSettings: jest.fn(),
};
const mockStorage = new Map<string, string>();
const mockNormalizeNotificationData = jest.fn((data = {}) => data);

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AndroidCategory: {
    CALL: 'call',
    MESSAGE: 'msg',
    SOCIAL: 'social',
  },
  AndroidImportance: {
    DEFAULT: 3,
    HIGH: 4,
  },
  EventType: {
    ACTION_PRESS: 2,
    PRESS: 1,
  },
}));
jest.mock('@social/shared', () => ({
  normalizeNotificationData: mockNormalizeNotificationData,
}), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
}));

describe('local notifications', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStorage.clear();
    mockNotifee.createChannel.mockResolvedValue('channel');
    mockNotifee.displayNotification.mockResolvedValue('notification-id');
    mockNotifee.getInitialNotification.mockResolvedValue(null);
    mockNotifee.onForegroundEvent.mockReturnValue(jest.fn());
  });

  it('does not display foreground message for active chat', async () => {
    const { setActivePushConversation } = require('./activeConversation');
    const { displayForegroundNotification } = require('./localNotifications');

    setActivePushConversation(42);

    await expect(displayForegroundNotification({
      type: 'message_received',
      conversationId: 42,
    })).resolves.toBe(false);
    expect(mockNotifee.displayNotification).not.toHaveBeenCalled();
  });

  it('displays foreground message when chat is not active', async () => {
    const { setActivePushConversation } = require('./activeConversation');
    const { displayForegroundNotification } = require('./localNotifications');

    setActivePushConversation(null);

    await expect(displayForegroundNotification({
      type: 'message_received',
      conversationId: 42,
      title: 'Alice',
      body: 'Hello',
    })).resolves.toBe(true);
    expect(mockNotifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Alice',
        body: 'Hello',
        android: expect.objectContaining({
          channelId: 'messages',
          smallIcon: 'ic_stat_social_notification',
        }),
      }),
    );
  });
});

export {};
