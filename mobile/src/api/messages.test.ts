const mockApiRequest = jest.fn();
const mockApiRequestMeta = jest.fn();

jest.mock('./http', () => ({
  apiCacheKey: (scope: string, key: string) => `${scope}:${key}`,
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestMeta: (...args: unknown[]) => mockApiRequestMeta(...args),
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

  it('uses the canonical flat conversation response', async () => {
    mockApiRequestMeta.mockResolvedValueOnce({
      data: [
        {
          user_id: 7,
          name: 'Peer User',
          last_message: 'hi',
          last_message_at: '2026-01-01T00:00:00.000Z',
          last_sender_id: 7,
          last_sender_name: 'Peer User',
          last_is_mine: false,
          last_read: false,
          unread_count: 1,
          is_pinned: false,
        },
      ],
      headers: {},
    });

    const { messageApi } = require('./messages');
    const { conversations } = await messageApi.getConversationsPage({
      limit: 50,
    });

    expect(conversations[0]).toMatchObject({
      user_id: 7,
      name: 'Peer User',
    });
  });

  it('uses the opaque response cursor without sending offset', async () => {
    mockApiRequestMeta.mockResolvedValueOnce({
      data: [],
      headers: { 'x-next-cursor': 'opaque.cursor' },
      fromCache: false,
      stale: false,
    });

    const { messageApi } = require('./messages');
    const page = await messageApi.getConversationsPage({
      limit: 50,
      cursor: 'previous.cursor',
    });

    expect(mockApiRequestMeta).toHaveBeenCalledWith(
      '/conversations?limit=50&cursor=previous.cursor',
      expect.objectContaining({
        cacheKey: expect.stringContaining('previous.cursor'),
      }),
    );
    expect(page).toMatchObject({
      conversations: [],
      has_more: true,
      next_cursor: 'opaque.cursor',
    });
  });
});

export {};
