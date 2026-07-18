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
      CALL_HEARTBEAT: 'call:heartbeat',
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

  it('keeps one physical socket and one reconnect timer', async () => {
    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      static instances: FakeWebSocket[] = [];

      readyState = FakeWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor() {
        FakeWebSocket.instances.push(this);
      }

      send() {}

      close() {
        this.readyState = FakeWebSocket.CLOSED;
      }
    }

    const originalWebSocket = globalThis.WebSocket;
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });

    try {
      const { chatSocket } = require('./ws');
      chatSocket.connect();
      await new Promise<void>(resolve => setImmediate(() => resolve()));

      chatSocket.connect();
      expect(FakeWebSocket.instances).toHaveLength(1);

      const socket = FakeWebSocket.instances[0];
      socket.readyState = FakeWebSocket.OPEN;
      socket.onopen?.();

      jest.useFakeTimers();
      socket.readyState = FakeWebSocket.CLOSED;
      socket.onclose?.();
      socket.onclose?.();
      expect(jest.getTimerCount()).toBe(1);

      chatSocket.disconnect();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: originalWebSocket,
      });
    }
  });
});

export {};
