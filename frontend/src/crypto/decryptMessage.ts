import type { Message } from "@/shared/types/domain.js";
import { base64ToBytes, bytesToUtf8 } from "@/crypto/encoding.js";
import { messageAAD, type EncryptedMessageEnvelope } from "@/crypto/encryptMessage.js";
import { type LocalE2EEKeyBundle } from "@/crypto/masterKey.js";

export function isEncryptedMessage(message?: Pick<Message, 'encryption_version' | 'ciphertext' | 'nonce'> | null): boolean {
    return Boolean(message && (message.encryption_version ?? 0) > 0 && message.ciphertext && message.nonce);
}

export async function decryptMessage(message: Message, currentUserId: number, bundle: LocalE2EEKeyBundle): Promise<string> {
    if (!isEncryptedMessage(message)) {
        return message.content || '';
    }

    const envelope = parseEnvelope(message.ciphertext || '');
    const wrappedKey = envelope.keys[String(currentUserId)];
    if (!wrappedKey) {
        throw new Error('No wrapped key for current user');
    }

    const rawMessageKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        bundle.privateKey,
        base64ToBytes(wrappedKey),
    );
    const messageKey = await crypto.subtle.importKey('raw', rawMessageKey, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: base64ToBytes(message.nonce || ''),
            additionalData: messageAAD(message.from_id, message.to_id),
        },
        messageKey,
        base64ToBytes(envelope.data),
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
