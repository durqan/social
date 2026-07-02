const mockApiRequest = jest.fn();

jest.mock(
  '@social/shared',
  () => ({
    CHAT_AUDIO_MAX_BYTES: 100,
    CHAT_AUDIO_MIME_TYPES: ['audio/mpeg'],
    CHAT_BLOCKED_ATTACHMENT_EXTENSIONS: [],
    CHAT_FILE_MAX_BYTES: 100,
    CHAT_FILE_MIME_TYPES: ['text/plain'],
    CHAT_IMAGE_MAX_BYTES: 100,
    CHAT_IMAGE_MIME_TYPES: ['image/jpeg'],
    CHAT_VIDEO_MAX_BYTES: 100,
    CHAT_VIDEO_MIME_TYPES: ['video/mp4'],
    CHAT_VOICE_MAX_BYTES: 100,
    CHAT_VOICE_MAX_DURATION_SECONDS: 60,
    CHAT_VIDEO_NOTE_MAX_BYTES: 100,
    CHAT_VIDEO_NOTE_MAX_DURATION_SECONDS: 60,
    CHAT_VIDEO_NOTE_MIME_TYPES: ['video/mp4'],
    formatDuration: (seconds: number) => `${seconds}s`,
    formatFileSize: (bytes: number) => `${bytes} bytes`,
  }),
  { virtual: true },
);

jest.mock('./http', () => ({
  apiCacheKey: (scope: string, key: string) => `${scope}:${key}`,
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  toQueryString: (params?: Record<string, unknown>) => {
    if (!params) {
      return '';
    }
    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('&');
    return query ? `?${query}` : '';
  },
}));

describe('message api conversation normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps legacy user_id as the chat peer id', async () => {
    mockApiRequest.mockResolvedValueOnce([
      {
        user_id: 7,
        name: 'Legacy User',
        last_message: 'hi',
        last_message_at: '2026-01-01T00:00:00.000Z',
        last_sender_id: 7,
        last_sender_name: 'Legacy User',
        last_is_mine: false,
        last_read: false,
        unread_count: 1,
        is_pinned: false,
      },
    ]);

    const { messageApi } = require('./messages');
    const conversations = await messageApi.getConversations();

    expect(conversations[0]).toMatchObject({
      user_id: 7,
      name: 'Legacy User',
    });
  });

  it('uses nested peer user data when conversation no longer has user_id', async () => {
    mockApiRequest.mockResolvedValueOnce([
      {
        other_user: {
          id: '42',
          name: 'Peer User',
          avatar: '/avatar.png',
          avatar_position_x: '44',
          avatar_position_y: '55',
          avatar_scale: '1.25',
          last_seen_at: '2026-01-02T00:00:00.000Z',
        },
        last_message: 'hello',
        last_message_at: '2026-01-01T00:00:00.000Z',
        last_sender_id: 42,
        last_sender_name: 'Peer User',
        last_is_mine: false,
        last_read: true,
        unread_count: 0,
        is_pinned: false,
      },
    ]);

    const { messageApi } = require('./messages');
    const conversations = await messageApi.getConversations();

    expect(conversations[0]).toMatchObject({
      user_id: 42,
      name: 'Peer User',
      avatar: '/avatar.png',
      avatar_position_x: 44,
      avatar_position_y: 55,
      avatar_scale: 1.25,
      last_seen_at: '2026-01-02T00:00:00.000Z',
    });
  });
});

export {};
