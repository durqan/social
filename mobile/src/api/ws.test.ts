const netInfoListeners: Array<(state: unknown) => void> = [];

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((listener: (state: unknown) => void) => {
    netInfoListeners.push(listener);
    return jest.fn();
  }),
}));

jest.mock(
  '@social/shared',
  () => ({
    WS_EVENTS: {
      MESSAGE_SEND: 'message:send',
      MESSAGE_READ: 'message:read',
      TYPING_START: 'typing:start',
      TYPING_STOP: 'typing:stop',
      CONVERSATION_ACTIVE: 'conversation:active',
      CONVERSATION_INACTIVE: 'conversation:inactive',
      CALL_OFFER: 'call:offer',
      CALL_ANSWER: 'call:answer',
      CALL_ICE: 'call:ice',
      CALL_END: 'call:end',
      CALL_REJECT: 'call:reject',
    },
  }),
  { virtual: true },
);

jest.mock('./http', () => ({
  getCookieHeader: jest.fn(() => Promise.resolve('')),
  refreshSession: jest.fn(() => Promise.resolve()),
}));

describe('chat socket listeners', () => {
  beforeEach(() => {
    jest.resetModules();
    netInfoListeners.splice(0);
  });

  it('does not duplicate the same message listener', () => {
    const { chatSocket } = require('./ws');
    const handler = jest.fn();

    const unsubscribeFirst = chatSocket.onMessage(handler);
    const unsubscribeSecond = chatSocket.onMessage(handler);

    chatSocket.handleRawMessage(JSON.stringify({ type: 'test', payload: {} }));

    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('removes stale listeners before later messages', () => {
    const { chatSocket } = require('./ws');
    const staleHandler = jest.fn();
    const activeHandler = jest.fn();

    const unsubscribeStale = chatSocket.onMessage(staleHandler);
    chatSocket.onMessage(activeHandler);
    unsubscribeStale();

    chatSocket.handleRawMessage(JSON.stringify({ type: 'test', payload: {} }));

    expect(staleHandler).not.toHaveBeenCalled();
    expect(activeHandler).toHaveBeenCalledTimes(1);
  });
});

export {};
