const mockNavigationRef = {
  isReady: jest.fn(),
  navigate: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => mockNavigationRef,
}));

describe('notification navigation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('stores pending route when navigation is not ready', async () => {
    mockNavigationRef.isReady.mockReturnValue(false);
    const { navigateFromNotification, flushPendingNotificationNavigation } = require('./navigation');

    navigateFromNotification({
      type: 'message_received',
      conversationId: 42,
    });

    expect(mockNavigationRef.navigate).not.toHaveBeenCalled();

    mockNavigationRef.isReady.mockReturnValue(true);
    flushPendingNotificationNavigation();

    expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Chats',
      params: {
        screen: 'Chat',
        params: {
          userId: 42,
          name: 'Чат',
        },
      },
    });
  });

  it('falls back to notifications screen without route data', async () => {
    mockNavigationRef.isReady.mockReturnValue(true);
    const { navigateFromNotification } = require('./navigation');

    navigateFromNotification({
      type: 'system',
    });

    expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Notifications',
    });
  });
});
