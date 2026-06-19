export type MobilePushTokenPayload = {
  provider: 'fcm';
  platform: 'android';
  token: string;
};

type TokenRegistrationOperations = {
  register: (payload: MobilePushTokenPayload) => Promise<void>;
  revoke: (payload: MobilePushTokenPayload) => Promise<void>;
};

export async function replaceMobilePushToken(
  previousPayload: MobilePushTokenPayload | null,
  nextPayload: MobilePushTokenPayload,
  operations: TokenRegistrationOperations,
) {
  await operations.register(nextPayload);
  if (
    previousPayload &&
    previousPayload.token !== nextPayload.token
  ) {
    await operations.revoke(previousPayload);
  }
  return nextPayload;
}
