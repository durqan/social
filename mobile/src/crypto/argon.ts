import { base64ToBytes, bytesToBase64, randomBytes, toArrayBuffer } from './encoding';
import { getSubtleCrypto } from './webCrypto';

type Argon2Module = typeof import('@noble/hashes/argon2.js');

let argon2ModulePromise: Promise<Argon2Module> | null = null;

async function getArgon2idAsync() {
  argon2ModulePromise ??= import('@noble/hashes/argon2.js');
  return (await argon2ModulePromise).argon2idAsync;
}

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

export async function deriveBackupKey(
  password: string,
  saltBase64: string,
  params: Argon2idParams = defaultArgon2idParams,
): Promise<CryptoKey> {
  if (!password) {
    throw new Error('Password is required to derive E2EE backup key');
  }

  const argon2idAsync = await getArgon2idAsync();
  const rawKey = await argon2idAsync(password, base64ToBytes(saltBase64), {
    t: params.iterations,
    m: params.memorySize,
    p: params.parallelism,
    dkLen: params.hashLength,
    asyncTick: 10,
  });

  return getSubtleCrypto().importKey('raw', toArrayBuffer(rawKey), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}
