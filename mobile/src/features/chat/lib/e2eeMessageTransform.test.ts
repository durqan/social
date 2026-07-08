import type { Message } from '../../../api/types';

const mockDecryptMessage = jest.fn();

jest.mock('../../../crypto/decryptMessage', () => ({
  decryptMessage: (...args: unknown[]) => mockDecryptMessage(...args),
  isEncryptedMessage: (message?: Partial<Message> | null) =>
    Boolean(
      message &&
        (message.encryption_version ?? 0) > 0 &&
        message.ciphertext &&
        message.nonce,
    ),
}));

jest.mock('../../../crypto/attachment', () => ({
  decryptAttachmentForDisplay: jest.fn(),
  isEncryptedAttachment: () => false,
}));

describe('e2ee message display transform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { clearE2EEMessageDisplayCache } = require('./e2eeMessageTransform');
    clearE2EEMessageDisplayCache();
  });

  it('reuses decrypted content while preserving fresh message metadata', async () => {
    mockDecryptMessage.mockResolvedValue('hello');
    const { decryptMessageForDisplay } = require('./e2eeMessageTransform');
    const bundle = {} as never;
    const encryptedMessage: Message = {
      id: 10,
      from_id: 2,
      to_id: 1,
      content: '',
      encryption_version: 1,
      ciphertext: '{"version":1}',
      nonce: 'nonce',
      created_at: '2026-01-01T00:00:00.000Z',
      is_read: false,
      reactions: [],
    };

    const first = await decryptMessageForDisplay(encryptedMessage, 1, bundle);
    const second = await decryptMessageForDisplay(
      {
        ...encryptedMessage,
        is_read: true,
        reaction_version: 2,
        reactions: [{ emoji: '+1', count: 1, reacted_by_me: true }],
      },
      1,
      bundle,
    );

    expect(mockDecryptMessage).toHaveBeenCalledTimes(1);
    expect(first.content).toBe('hello');
    expect(second).toMatchObject({
      content: 'hello',
      is_read: true,
      reaction_version: 2,
      reactions: [{ emoji: '+1', count: 1, reacted_by_me: true }],
    });
  });
});

export {};
