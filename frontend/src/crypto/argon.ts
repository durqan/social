import { argon2id } from 'hash-wasm';

import { base64ToBytes, bytesToBase64, randomBytes } from "@/crypto/encoding.js";

export type Argon2idParams = {
    memorySize: number;
    iterations: number;
    parallelism: number;
    hashLength: number;
};

export const defaultArgon2idParams: Argon2idParams = {
    memorySize: 65536,
    iterations: 3,
    parallelism: 1,
    hashLength: 32,
};

export function createArgon2idSalt(): string {
    return bytesToBase64(randomBytes(16));
}

export async function deriveBackupKey(password: string, saltBase64: string, params: Argon2idParams = defaultArgon2idParams): Promise<CryptoKey> {
    if (!password) {
        throw new Error('Password is required to derive E2EE backup key');
    }

    const rawKey = await argon2id({
        password,
        salt: base64ToBytes(saltBase64),
        parallelism: params.parallelism,
        iterations: params.iterations,
        memorySize: params.memorySize,
        hashLength: params.hashLength,
        outputType: 'binary',
    });

    if (!(rawKey instanceof Uint8Array)) {
        throw new Error('Argon2id did not return binary output');
    }

    return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
