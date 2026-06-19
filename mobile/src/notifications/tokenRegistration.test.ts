import {
  replaceMobilePushToken,
  type MobilePushTokenPayload,
} from './tokenRegistration';

describe('replaceMobilePushToken', () => {
  const previous: MobilePushTokenPayload = {
    provider: 'fcm',
    platform: 'android',
    token: 'previous-token',
  };
  const next: MobilePushTokenPayload = {
    provider: 'fcm',
    platform: 'android',
    token: 'next-token',
  };

  it('registers the new token before revoking the old token', async () => {
    const calls: string[] = [];

    await expect(replaceMobilePushToken(previous, next, {
      register: async payload => {
        calls.push(`register:${payload.token}`);
      },
      revoke: async payload => {
        calls.push(`revoke:${payload.token}`);
      },
    })).resolves.toEqual(next);

    expect(calls).toEqual([
      'register:next-token',
      'revoke:previous-token',
    ]);
  });

  it('keeps the previous token active when registration fails', async () => {
    const revoke = jest.fn();

    await expect(replaceMobilePushToken(previous, next, {
      register: async () => {
        throw new Error('network error');
      },
      revoke,
    })).rejects.toThrow('network error');

    expect(revoke).not.toHaveBeenCalled();
  });

  it('does not revoke when Firebase returns the same token', async () => {
    const revoke = jest.fn();

    await replaceMobilePushToken(previous, previous, {
      register: async () => undefined,
      revoke,
    });

    expect(revoke).not.toHaveBeenCalled();
  });
});
