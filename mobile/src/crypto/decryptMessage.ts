import type { Message } from '../api/types';
import { base64ToBytes, bytesToUtf8, toArrayBuffer } from './encoding';
import { messageAAD, type EncryptedMessageEnvelope } from './encryptMessage';
import type { LocalE2EEKeyBundle } from './masterKey';
import { getSubtleCrypto } from './webCrypto';

export function isEncryptedMessage(
  message?: Pick<Message, 'encryption_version' | 'ciphertext' | 'nonce'> | null,
) {
  return Boolean(
    message &&
      (message.encryption_version ?? 0) > 0 &&
      message.ciphertext &&
      message.nonce,
  );
}

export async function decryptMessage(
  message: Message,
  currentUserId: number,
  bundle: LocalE2EEKeyBundle,
) {
  if (!isEncryptedMessage(message)) {
    return message.content || '';
  }

  const subtle = getSubtleCrypto();
  const envelope = parseEnvelope(message.ciphertext || '');
  const wrappedKey = envelope.keys[String(currentUserId)];
  if (!wrappedKey) {
    throw new Error('No wrapped key for current user');
  }

  const rawMessageKey = await subtle.decrypt(
    { name: 'RSA-OAEP' },
    bundle.privateKey,
    toArrayBuffer(base64ToBytes(wrappedKey)),
  );
  const messageKey = await subtle.importKey('raw', rawMessageKey, 'AES-GCM', false, [
    'decrypt',
  ]);
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(message.nonce || '')),
      additionalData: toArrayBuffer(messageAAD(message.from_id, message.to_id)),
    },
    messageKey,
    toArrayBuffer(base64ToBytes(envelope.data)),
  );

  return bytesToUtf8(plaintext);
}

function parseEnvelope(value: string): EncryptedMessageEnvelope {
  const parsed = JSON.parse(value) as Partial<EncryptedMessageEnvelope>;
  if (
    parsed.version !== 1 ||
    parsed.alg !== 'AES-256-GCM' ||
    parsed.keyAlg !== 'RSA-OAEP-SHA-256' ||
    !parsed.data ||
    !parsed.keys ||
    typeof parsed.keys !== 'object'
  ) {
    throw new Error('Invalid encrypted message envelope');
  }
  return parsed as EncryptedMessageEnvelope;
}
