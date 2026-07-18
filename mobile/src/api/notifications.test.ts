const mockApiRequest = jest.fn();
const mockApiRequestMeta = jest.fn();

jest.mock('./http', () => ({
  apiCacheKey: jest.fn(() => 'cache-key'),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  apiRequestMeta: (...args: unknown[]) => mockApiRequestMeta(...args),
}));

import { notificationsApi } from './notifications';

describe('notifications API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApiRequest.mockResolvedValue({ status: 'registered' });
  });

  it('uses the shared CSRF flow for mobile push token mutations', async () => {
    await notificationsApi.registerMobilePushToken({
      provider: 'fcm',
      platform: 'android',
      token: 'device-token',
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      '/push/mobile-token',
      expect.objectContaining({
        method: 'POST',
        includeCookieHeader: true,
      }),
    );
    expect(mockApiRequest.mock.calls[0][1]).not.toHaveProperty('csrf');
  });
});
