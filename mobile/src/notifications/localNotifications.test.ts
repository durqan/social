const mockNotifee = {
  createChannel: jest.fn(),
  displayNotification: jest.fn(),
  getInitialNotification: jest.fn(),
  onBackgroundEvent: jest.fn(),
  onForegroundEvent: jest.fn(),
  openNotificationSettings: jest.fn(),
};
const mockStorage = new Map<string, string>();

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AndroidCategory: {
    CALL: 'call',
    MESSAGE: 'msg',
    SOCIAL: 'social',
  },
  AndroidFlags: {
    FLAG_INSISTENT: 4,
  },
  AndroidImportance: {
    DEFAULT: 3,
    HIGH: 4,
  },
  AndroidLaunchActivityFlag: {
    SINGLE_TOP: 1,
    NEW_TASK: 2,
    CLEAR_TOP: 4,
  },
  AndroidVisibility: {
    PUBLIC: 1,
  },
  EventType: {
    ACTION_PRESS: 2,
    PRESS: 1,
  },
}));
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

  it('displays incoming calls as full-screen call notifications', async () => {
    const { displayForegroundNotification } = require('./localNotifications');

    await expect(displayForegroundNotification({
      type: 'incoming_call',
      callId: 'call-1',
      callType: 'video',
      body: 'Alice звонит вам',
      timestamp: 1000,
    })).resolves.toBe(true);

    expect(mockNotifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Alice звонит вам',
        body: 'Видеозвонок',
        android: expect.objectContaining({
          channelId: 'incoming_calls',
          category: 'call',
          importance: 4,
          visibility: 1,
          lightUpScreen: true,
          loopSound: true,
          ongoing: true,
          autoCancel: false,
          fullScreenAction: expect.objectContaining({
            id: 'default',
            launchActivity: 'default',
            launchActivityFlags: [2, 1, 4],
          }),
          pressAction: expect.objectContaining({
            launchActivityFlags: [2, 1, 4],
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({ title: 'Ответить' }),
            expect.objectContaining({ title: 'Отклонить' }),
          ]),
        }),
      }),
    );
  });
});

export {};
