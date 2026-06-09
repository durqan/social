import {
  createArgon2idSalt,
  defaultArgon2idParams,
  deriveBackupKey,
  type Argon2idParams,
} from './argon';
import { base64ToBytes, bytesToBase64, randomNonce, toArrayBuffer } from './encoding';
import {
  clearLocalE2EEKeyBundle,
  createLocalE2EEKeyBundle,
  exportPublicKeyBase64,
  getLocalE2EEKeyBundle,
  importMasterKey,
  importPrivateKey,
  importPublicKey,
  saveLocalE2EEKeyBundle,
  type LocalE2EEKeyBundle,
} from './masterKey';
import { getSubtleCrypto } from './webCrypto';

export type EncryptedMasterKeyBackup = {
  version: 1;
  algorithm: 'AES-256-GCM';
  kdf: {
    name: 'argon2id';
    salt: string;
  } & Argon2idParams;
  encryptedMasterKey: string;
  masterKeyNonce: string;
  publicKey: string;
  encryptedPrivateKey: string;
  privateKeyNonce: string;
  privateKeyAlgorithm: 'RSA-OAEP-3072-SHA-256';
  createdAt: string;
};

export async function enableE2EEForUser(userId: number, password: string) {
  const bundle = await createLocalE2EEKeyBundle(userId);
  return createEncryptedMasterKeyBackup(bundle, password);
}

export async function createEncryptedMasterKeyBackup(
  bundle: LocalE2EEKeyBundle,
  password: string,
) {
  const subtle = getSubtleCrypto();
  const salt = createArgon2idSalt();
  const backupKey = await deriveBackupKey(password, salt, defaultArgon2idParams);
  const masterKeyNonce = randomNonce();
  const privateKeyNonce = randomNonce();
  const rawMasterKey = await subtle.exportKey('raw', bundle.masterKey);
  const rawPrivateKey = await subtle.exportKey('pkcs8', bundle.privateKey);
  const publicKey = bundle.publicKeyBase64 || (await exportPublicKeyBase64(bundle.publicKey));

  const encryptedMasterKey = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(masterKeyNonce) },
    backupKey,
    rawMasterKey,
  );
  const encryptedPrivateKey = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(privateKeyNonce) },
    bundle.masterKey,
    rawPrivateKey,
  );

  const payload: EncryptedMasterKeyBackup = {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: {
      name: 'argon2id',
      salt,
      ...defaultArgon2idParams,
    },
    encryptedMasterKey: bytesToBase64(encryptedMasterKey),
    masterKeyNonce: bytesToBase64(masterKeyNonce),
    publicKey,
    encryptedPrivateKey: bytesToBase64(encryptedPrivateKey),
    privateKeyNonce: bytesToBase64(privateKeyNonce),
    privateKeyAlgorithm: 'RSA-OAEP-3072-SHA-256',
    createdAt: new Date().toISOString(),
  };

  return JSON.stringify(payload);
}

export async function restoreE2EEFromBackup(
  userId: number,
  password: string,
  encryptedBackup: string,
): Promise<LocalE2EEKeyBundle> {
  const subtle = getSubtleCrypto();
  const payload = parseEncryptedMasterKeyBackup(encryptedBackup);
  const backupKey = await deriveBackupKey(password, payload.kdf.salt, payload.kdf);
  const rawMasterKey = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payload.masterKeyNonce)) },
    backupKey,
    toArrayBuffer(base64ToBytes(payload.encryptedMasterKey)),
  );
  const masterKey = await importMasterKey(rawMasterKey);
  const rawPrivateKey = await subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(payload.privateKeyNonce)) },
    masterKey,
    toArrayBuffer(base64ToBytes(payload.encryptedPrivateKey)),
  );
  const privateKey = await importPrivateKey(rawPrivateKey);
  const publicKey = await importPublicKey(payload.publicKey);

  const bundle: LocalE2EEKeyBundle = {
    userId,
    masterKey,
    privateKey,
    publicKey,
    publicKeyBase64: payload.publicKey,
    createdAt: payload.createdAt,
  };
  await saveLocalE2EEKeyBundle(bundle);
  return bundle;
}

export async function reencryptBackupWithPassword(userId: number, newPassword: string) {
  const bundle = await getLocalE2EEKeyBundle(userId);
  if (!bundle) {
    return null;
  }
  return createEncryptedMasterKeyBackup(bundle, newPassword);
}

export { clearLocalE2EEKeyBundle };

function parseEncryptedMasterKeyBackup(value: string): EncryptedMasterKeyBackup {
  const parsed = JSON.parse(value) as Partial<EncryptedMasterKeyBackup>;
  if (
    parsed.version !== 1 ||
    parsed.algorithm !== 'AES-256-GCM' ||
    parsed.kdf?.name !== 'argon2id' ||
    !parsed.kdf.salt ||
    !parsed.encryptedMasterKey ||
    !parsed.masterKeyNonce ||
    !parsed.publicKey ||
    !parsed.encryptedPrivateKey ||
    !parsed.privateKeyNonce
  ) {
    throw new Error('Invalid encrypted E2EE backup');
  }

  return parsed as EncryptedMasterKeyBackup;
}
