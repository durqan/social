import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import { warnDev } from '../utils/logger';
import { base64ToBytes, bytesToBase64, toArrayBuffer } from './encoding';
import { getSubtleCrypto } from './webCrypto';

const keyStoragePrefix = 'social.e2ee.keys.';
const secureKeyStoragePrefix = 'social.e2ee.secure.keys.';

export type LocalE2EEKeyBundle = {
  userId: number;
  masterKey: CryptoKey;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBase64: string;
  createdAt: string;
};

type StoredE2EEKeyBundle = {
  userId: number;
  masterKey: string;
  privateKey: string;
  publicKey: string;
  createdAt: string;
};

type LocalKeyChangeListener = () => void;
const localKeyListeners = new Set<LocalKeyChangeListener>();

function storageKey(userId: number) {
  return `${keyStoragePrefix}${userId}`;
}

function secureStorageService(userId: number) {
  return `${secureKeyStoragePrefix}${userId}`;
}

function secureStorageOptions(userId: number) {
  return {
    service: secureStorageService(userId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

function isStoredE2EEKeyBundle(value: unknown): value is StoredE2EEKeyBundle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const bundle = value as Partial<StoredE2EEKeyBundle>;
  return (
    typeof bundle.userId === 'number' &&
    typeof bundle.masterKey === 'string' &&
    Boolean(bundle.masterKey) &&
    typeof bundle.privateKey === 'string' &&
    Boolean(bundle.privateKey) &&
    typeof bundle.publicKey === 'string' &&
    Boolean(bundle.publicKey) &&
    typeof bundle.createdAt === 'string' &&
    Boolean(bundle.createdAt)
  );
}

function parseStoredE2EEKeyBundle(raw: string): StoredE2EEKeyBundle | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStoredE2EEKeyBundle(parsed) ? parsed : null;
  } catch (error) {
    warnDev('[E2EE] Failed to parse local key bundle', error);
    return null;
  }
}

async function readSecureStoredBundle(
  userId: number,
): Promise<StoredE2EEKeyBundle | null> {
  try {
    const credentials = await Keychain.getGenericPassword(
      secureStorageOptions(userId),
    );
    if (!credentials) {
      return null;
    }
    return parseStoredE2EEKeyBundle(credentials.password);
  } catch (error) {
    warnDev('[E2EE] Failed to read secure local key bundle', error);
    return null;
  }
}

async function saveSecureStoredBundle(
  userId: number,
  stored: StoredE2EEKeyBundle,
): Promise<boolean> {
  try {
    await Keychain.setGenericPassword(
      String(userId),
      JSON.stringify(stored),
      secureStorageOptions(userId),
    );
    return true;
  } catch (error) {
    warnDev('[E2EE] Failed to save secure local key bundle', error);
    return false;
  }
}

async function removeSecureStoredBundle(userId: number): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: secureStorageService(userId) });
  } catch (error) {
    warnDev('[E2EE] Failed to clear secure local key bundle', error);
  }
}

async function readLegacyStoredBundle(
  userId: number,
): Promise<StoredE2EEKeyBundle | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? parseStoredE2EEKeyBundle(raw) : null;
  } catch (error) {
    warnDev('[E2EE] Failed to read legacy local key bundle', error);
    return null;
  }
}

async function removeLegacyStoredBundle(userId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch (error) {
    warnDev('[E2EE] Failed to clear legacy local key bundle', error);
  }
}

async function importStoredE2EEKeyBundle(
  userId: number,
  stored: StoredE2EEKeyBundle,
): Promise<LocalE2EEKeyBundle | null> {
  try {
    const [masterKey, privateKey, publicKey] = await Promise.all([
      importMasterKey(toArrayBuffer(base64ToBytes(stored.masterKey))),
      importPrivateKey(toArrayBuffer(base64ToBytes(stored.privateKey))),
      importPublicKey(stored.publicKey),
    ]);

    return {
      userId,
      masterKey,
      privateKey,
      publicKey,
      publicKeyBase64: stored.publicKey,
      createdAt: stored.createdAt,
    };
  } catch (error) {
    warnDev('[E2EE] Failed to import local key bundle', error);
    return null;
  }
}

export async function generateMasterKey(): Promise<CryptoKey> {
  return getSubtleCrypto().generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function generateMessageKeyPair(): Promise<CryptoKeyPair> {
  return getSubtleCrypto().generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  ) as Promise<CryptoKeyPair>;
}

export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
  return bytesToBase64(await getSubtleCrypto().exportKey('spki', publicKey));
}

export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  return getSubtleCrypto().importKey(
    'spki',
    toArrayBuffer(base64ToBytes(publicKeyBase64)),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt'],
  );
}

export async function importPrivateKey(privateKeyBytes: ArrayBuffer): Promise<CryptoKey> {
  return getSubtleCrypto().importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt'],
  );
}

export async function importMasterKey(rawMasterKey: ArrayBuffer): Promise<CryptoKey> {
  return getSubtleCrypto().importKey('raw', rawMasterKey, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function createLocalE2EEKeyBundle(
  userId: number,
): Promise<LocalE2EEKeyBundle> {
  const masterKey = await generateMasterKey();
  const keyPair = await generateMessageKeyPair();
  const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

  const bundle: LocalE2EEKeyBundle = {
    userId,
    masterKey,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyBase64,
    createdAt: new Date().toISOString(),
  };
  await saveLocalE2EEKeyBundle(bundle);
  return bundle;
}

export async function saveLocalE2EEKeyBundle(bundle: LocalE2EEKeyBundle) {
  const subtle = getSubtleCrypto();
  const stored: StoredE2EEKeyBundle = {
    userId: bundle.userId,
    masterKey: bytesToBase64(await subtle.exportKey('raw', bundle.masterKey)),
    privateKey: bytesToBase64(await subtle.exportKey('pkcs8', bundle.privateKey)),
    publicKey:
      bundle.publicKeyBase64 ||
      bytesToBase64(await subtle.exportKey('spki', bundle.publicKey)),
    createdAt: bundle.createdAt,
  };

  const saved = await saveSecureStoredBundle(bundle.userId, stored);
  if (!saved) {
    throw new Error('Failed to save E2EE keys securely');
  }

  await removeLegacyStoredBundle(bundle.userId);
  dispatchLocalKeyChanged();
}

export async function getLocalE2EEKeyBundle(
  userId?: number,
): Promise<LocalE2EEKeyBundle | null> {
  if (!userId) {
    return null;
  }

  const secureStored = await readSecureStoredBundle(userId);
  if (secureStored) {
    return importStoredE2EEKeyBundle(userId, secureStored);
  }

  const legacyStored = await readLegacyStoredBundle(userId);
  if (!legacyStored) {
    return null;
  }

  const legacyBundle = await importStoredE2EEKeyBundle(userId, legacyStored);
  if (!legacyBundle) {
    return null;
  }

  const migrated = await saveSecureStoredBundle(userId, legacyStored);
  if (migrated) {
    await removeLegacyStoredBundle(userId);
    dispatchLocalKeyChanged();
  }

  return legacyBundle;
}

export async function clearLocalE2EEKeyBundle(userId?: number) {
  if (!userId) {
    return;
  }

  await Promise.all([
    removeSecureStoredBundle(userId),
    removeLegacyStoredBundle(userId),
  ]);
  dispatchLocalKeyChanged();
}

export function addLocalE2EEKeyChangeListener(listener: LocalKeyChangeListener) {
  localKeyListeners.add(listener);
  return () => localKeyListeners.delete(listener);
}

function dispatchLocalKeyChanged() {
  localKeyListeners.forEach(listener => listener());
}
