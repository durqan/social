const mockStorage = new Map<string, string>();
const mockPendingIncomingCall = {
  rememberPendingIncomingCall: jest.fn(() => Promise.resolve(null)),
  rememberTerminalIncomingCall: jest.fn(() => Promise.resolve()),
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) =>
    Promise.resolve(mockStorage.get(key) ?? null),
  ),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));
jest.mock('./pendingIncomingCall', () => mockPendingIncomingCall);

describe('push effects', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('stores background notification_sync as pending message read refresh', async () => {
    const {
      enqueuePendingPushEvent,
      drainPendingPushEvents,
    } = require('./pushEffects');

    await enqueuePendingPushEvent({
      type: 'notification_sync',
      syncAction: 'message_read',
      conversationId: 42,
    });

    const events = await drainPendingPushEvents();
    expect(events).toHaveLength(1);
    expect(events[0].effects).toEqual([
      {
        type: 'message_read',
        conversationId: 42,
      },
      {
        type: 'chat_changed',
        conversationId: 42,
      },
      { type: 'refresh_unread' },
      { type: 'refresh_notifications' },
    ]);
  });

  it('stores background message_read as pending refresh', async () => {
    const {
      enqueuePendingPushEvent,
      drainPendingPushEvents,
    } = require('./pushEffects');

    await enqueuePendingPushEvent({
      type: 'message_read',
      conversationId: 7,
    });

    const [event] = await drainPendingPushEvents();
    expect(event.effects).toEqual(
      expect.arrayContaining([
        {
          type: 'message_read',
          conversationId: 7,
        },
        { type: 'refresh_notifications' },
      ]),
    );
  });

  it('applies foreground message read effects through handlers', async () => {
    const { applyPushNotificationEffects } = require('./pushEffects');
    const handlers = {
      markConversationRead: jest.fn(),
      signalChatDataChanged: jest.fn(),
      refreshUnreadCount: jest.fn(),
      refreshNotifications: jest.fn(),
    };

    applyPushNotificationEffects(
      {
        type: 'notification_sync',
        syncAction: 'message_read',
        conversationId: 9,
      },
      handlers,
    );

    expect(handlers.markConversationRead).toHaveBeenCalledWith(9);
    expect(handlers.signalChatDataChanged).toHaveBeenCalledTimes(1);
    expect(handlers.refreshUnreadCount).toHaveBeenCalledTimes(1);
    expect(handlers.refreshNotifications).toHaveBeenCalledTimes(1);
  });

  it('records terminal call pushes so incoming push cannot resurrect them', async () => {
    const {
      applyPushNotificationEffects,
      enqueuePendingPushEvent,
    } = require('./pushEffects');

    applyPushNotificationEffects(
      {
        type: 'call_ended',
        callId: 'call-1',
      },
      {},
    );
    expect(
      mockPendingIncomingCall.rememberTerminalIncomingCall,
    ).toHaveBeenCalledWith('call-1');

    await enqueuePendingPushEvent(
      {
        type: 'call_missed',
        callId: 'call-2',
      },
      1_000_000,
    );
    expect(
      mockPendingIncomingCall.rememberTerminalIncomingCall,
    ).toHaveBeenCalledWith('call-2', 1_000_000);
  });
});

export {};
