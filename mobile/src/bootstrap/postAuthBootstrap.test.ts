const mockPushNotifications = {
  beginMobilePushSession: jest.fn(),
  ensureMobilePushReady: jest.fn(),
  resetMobilePushSession: jest.fn(),
};

jest.mock('../notifications/pushNotifications', () => ({
  beginMobilePushSession: mockPushNotifications.beginMobilePushSession,
  ensureMobilePushReady: mockPushNotifications.ensureMobilePushReady,
  resetMobilePushSession: mockPushNotifications.resetMobilePushSession,
}));

describe('post auth bootstrap', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPushNotifications.resetMobilePushSession.mockResolvedValue(undefined);
  });

  it('calls ensureMobilePushReady after auth', async () => {
    const session = { key: '1:1', isCurrent: () => true };
    mockPushNotifications.beginMobilePushSession.mockReturnValue(session);
    mockPushNotifications.ensureMobilePushReady.mockResolvedValue(true);

    const { runPostAuthBootstrap } = require('./postAuthBootstrap');
    await runPostAuthBootstrap(1);

    expect(mockPushNotifications.beginMobilePushSession).toHaveBeenCalledWith(1);
    expect(mockPushNotifications.ensureMobilePushReady).toHaveBeenCalledWith(session);
  });

  it('dedupes parallel bootstrap calls for the same user', async () => {
    const session = { key: '2:1', isCurrent: () => true };
    mockPushNotifications.beginMobilePushSession.mockReturnValue(session);
    mockPushNotifications.ensureMobilePushReady.mockResolvedValue(true);

    const { runPostAuthBootstrap } = require('./postAuthBootstrap');
    await Promise.all([runPostAuthBootstrap(2), runPostAuthBootstrap(2)]);

    expect(mockPushNotifications.ensureMobilePushReady).toHaveBeenCalledTimes(1);
  });

  it('old session bootstrap cannot run after user switch', async () => {
    const oldSession = { key: '3:1', isCurrent: () => false };
    const newSession = { key: '4:2', isCurrent: () => true };
    mockPushNotifications.beginMobilePushSession
      .mockReturnValueOnce(oldSession)
      .mockReturnValueOnce(newSession);
    let resolveOld!: () => void;
    mockPushNotifications.ensureMobilePushReady
      .mockReturnValueOnce(new Promise<boolean>(resolve => {
        resolveOld = () => resolve(true);
      }))
      .mockResolvedValueOnce(true);

    const { runPostAuthBootstrap } = require('./postAuthBootstrap');
    const oldBootstrap = runPostAuthBootstrap(3);
    await Promise.resolve();
    expect(mockPushNotifications.ensureMobilePushReady).toHaveBeenCalledWith(oldSession);

    await runPostAuthBootstrap(4);
    expect(mockPushNotifications.ensureMobilePushReady).toHaveBeenCalledWith(newSession);

    resolveOld();
    await oldBootstrap;
  });

  it('remount reset does not revoke tokens directly', async () => {
    const { resetPostAuthBootstrap } = require('./postAuthBootstrap');
    await resetPostAuthBootstrap();

    expect(mockPushNotifications.resetMobilePushSession).toHaveBeenCalledTimes(1);
  });
});
