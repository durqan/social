const mockNavigationRef = {
  isReady: jest.fn(),
  navigate: jest.fn(),
};
const mockPendingIncomingCall = {
  rememberPendingIncomingCall: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: () => mockNavigationRef,
}));
jest.mock('./pendingIncomingCall', () => mockPendingIncomingCall);

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
        initial: false,
        screen: 'Chat',
        params: {
          userId: 42,
          name: 'Чат',
          incomingCall: false,
          callId: undefined,
        },
      },
    });
  });

  it('opens chat route for a notification with conversationId', async () => {
    mockNavigationRef.isReady.mockReturnValue(true);
    const { navigateFromNotification } = require('./navigation');

    navigateFromNotification({
      type: 'message_received',
      conversationId: 77,
    });

    expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Chats',
      params: {
        initial: false,
        screen: 'Chat',
        params: {
          userId: 77,
          name: 'Чат',
          incomingCall: false,
          callId: undefined,
        },
      },
    });
  });

  it('prefers actorId over conversationId for chat peer routing', async () => {
    mockNavigationRef.isReady.mockReturnValue(true);
    const { navigateFromNotification } = require('./navigation');

    navigateFromNotification({
      type: 'message_received',
      actorId: 12,
      conversationId: 77,
    });

    expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Chats',
      params: {
        initial: false,
        screen: 'Chat',
        params: {
          userId: 12,
          name: 'Чат',
          incomingCall: false,
          callId: undefined,
        },
      },
    });
  });

  it('keeps callId when opening incoming call notification', async () => {
    mockNavigationRef.isReady.mockReturnValue(true);
    mockPendingIncomingCall.rememberPendingIncomingCall.mockResolvedValue(null);
    const { navigateFromNotification } = require('./navigation');

    navigateFromNotification({
      type: 'incoming_call',
      conversationId: 81,
      callId: 'call-123',
    });

    expect(mockPendingIncomingCall.rememberPendingIncomingCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'incoming_call',
        callId: 'call-123',
      }),
    );
    expect(mockNavigationRef.navigate).toHaveBeenCalledWith('MainTabs', {
      screen: 'Chats',
      params: {
        initial: false,
        screen: 'Chat',
        params: {
          userId: 81,
          name: 'Входящий звонок',
          incomingCall: true,
          callId: 'call-123',
        },
      },
    });
  });

  it('maps post and comment notifications to the same route as notification list', async () => {
    const { notificationRouteFromPayload } = require('./navigation');

    expect(notificationRouteFromPayload({ type: 'post_liked' })).toEqual({
      kind: 'tab',
      tab: 'Home',
    });
    expect(notificationRouteFromPayload({ type: 'comment_created' })).toEqual({
      kind: 'tab',
      tab: 'Home',
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

export {};
