import { bytesToArrayBuffer, bytesToBase64, randomNonce, utf8ToBytes } from "@/crypto/encoding.js";
import { importPublicKey, type LocalE2EEKeyBundle } from "@/crypto/masterKey.js";

export type EncryptedMessageEnvelope = {
    version: 1;
    alg: 'AES-256-GCM';
    keyAlg: 'RSA-OAEP-SHA-256';
    data: string;
    keys: Record<string, string>;
};

export type EncryptedMessagePayload = {
    encryption_version: 1;
    ciphertext: string;
    nonce: string;
};

type EncryptMessageInput = {
    plaintext: string;
    senderUserId: number;
    recipientUserId: number;
    senderBundle: LocalE2EEKeyBundle;
    recipientPublicKeyBase64: string;
};

export async function encryptMessage({
    plaintext,
    senderUserId,
    recipientUserId,
    senderBundle,
    recipientPublicKeyBase64,
}: EncryptMessageInput): Promise<EncryptedMessagePayload> {
    const messageKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
    const nonce = randomNonce();
    const additionalData = messageAAD(senderUserId, recipientUserId);
    const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: bytesToArrayBuffer(nonce), additionalData: bytesToArrayBuffer(additionalData) },
        messageKey,
        bytesToArrayBuffer(utf8ToBytes(plaintext)),
    );
    const rawMessageKey = await crypto.subtle.exportKey('raw', messageKey);
    const recipientPublicKey = await importPublicKey(recipientPublicKeyBase64);
    const senderWrappedKey = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        senderBundle.publicKey,
        rawMessageKey,
    );
    const recipientWrappedKey = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        recipientPublicKey,
        rawMessageKey,
    );

    const envelope: EncryptedMessageEnvelope = {
        version: 1,
        alg: 'AES-256-GCM',
        keyAlg: 'RSA-OAEP-SHA-256',
        data: bytesToBase64(data),
        keys: {
            [String(senderUserId)]: bytesToBase64(senderWrappedKey),
            [String(recipientUserId)]: bytesToBase64(recipientWrappedKey),
        },
    };

    return {
        encryption_version: 1,
        ciphertext: JSON.stringify(envelope),
        nonce: bytesToBase64(nonce),
    };
}

export function messageAAD(fromId: number, toId: number): Uint8Array {
    return utf8ToBytes(`social:e2ee:v1:${fromId}:${toId}`);
}
