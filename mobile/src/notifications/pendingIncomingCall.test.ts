const mockStorage = new Map<string, string>();

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

describe('pending incoming call push', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStorage.clear();
  });

  it('builds and stores fresh incoming call metadata', async () => {
    const {
      consumePendingIncomingCall,
      incomingCallFromNotification,
      rememberPendingIncomingCall,
    } = require('./pendingIncomingCall');
    const now = 1_000_000;
    const notification = {
      type: 'incoming_call',
      callId: 'call-1',
      actorId: 5,
      conversationId: 5,
      title: 'Alice',
      url: `/users/10/chat/5?incomingCall=1&callId=call-1&ts=${now}`,
    };

    expect(
      incomingCallFromNotification(notification, now + 1000),
    ).toMatchObject({
      callId: 'call-1',
      callerId: 5,
      callerName: 'Alice',
      conversationId: 5,
    });

    await rememberPendingIncomingCall(notification, now + 1000);
    await expect(consumePendingIncomingCall(now + 1000)).resolves.toMatchObject(
      {
        callId: 'call-1',
        callerId: 5,
      },
    );
  });

  it('drops stale incoming call payloads', async () => {
    const { incomingCallFromNotification } = require('./pendingIncomingCall');
    const now = 1_000_000;

    expect(
      incomingCallFromNotification(
        {
          type: 'incoming_call',
          callId: 'old-call',
          actorId: 5,
          url: `/users/10/chat/5?incomingCall=1&callId=old-call&ts=${
            now - 120_000
          }`,
        },
        now,
      ),
    ).toBeNull();
  });

  it('does not resurrect a call after a terminal event tombstone', async () => {
    const {
      consumePendingIncomingCall,
      rememberPendingIncomingCall,
      rememberTerminalIncomingCall,
    } = require('./pendingIncomingCall');
    const now = 1_000_000;
    const notification = {
      type: 'incoming_call',
      callId: 'call-ended',
      actorId: 5,
      conversationId: 5,
      title: 'Alice',
      url: `/users/10/chat/5?incomingCall=1&callId=call-ended&ts=${now}`,
    };

    await rememberTerminalIncomingCall('call-ended', now);
    await expect(
      rememberPendingIncomingCall(notification, now + 1000),
    ).resolves.toBeNull();
    await expect(consumePendingIncomingCall(now + 1000)).resolves.toBeNull();
  });

  it('clears only the matching pending call when terminal arrives', async () => {
    const {
      consumePendingIncomingCall,
      rememberPendingIncomingCall,
      rememberTerminalIncomingCall,
    } = require('./pendingIncomingCall');
    const now = 1_000_000;

    await rememberPendingIncomingCall(
      {
        type: 'incoming_call',
        callId: 'call-live',
        actorId: 5,
        url: `/users/10/chat/5?incomingCall=1&callId=call-live&ts=${now}`,
      },
      now,
    );
    await rememberTerminalIncomingCall('call-other', now + 1000);

    await expect(consumePendingIncomingCall(now + 2000)).resolves.toMatchObject(
      {
        callId: 'call-live',
      },
    );
  });
});

export {};
