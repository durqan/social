import AsyncStorage from '@react-native-async-storage/async-storage';

import { base64ToBytes, bytesToBase64, toArrayBuffer } from './encoding';
import { getSubtleCrypto } from './webCrypto';

const keyStoragePrefix = 'social.e2ee.keys.';

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
    publicKey: bundle.publicKeyBase64 || bytesToBase64(await subtle.exportKey('spki', bundle.publicKey)),
    createdAt: bundle.createdAt,
  };

  await AsyncStorage.setItem(storageKey(bundle.userId), JSON.stringify(stored));
  dispatchLocalKeyChanged();
}

export async function getLocalE2EEKeyBundle(
  userId?: number,
): Promise<LocalE2EEKeyBundle | null> {
  if (!userId) {
    return null;
  }

  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) {
    return null;
  }

  const stored = JSON.parse(raw) as StoredE2EEKeyBundle;
  if (!stored.masterKey || !stored.privateKey || !stored.publicKey) {
    return null;
  }

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
}

export async function clearLocalE2EEKeyBundle(userId?: number) {
  if (!userId) {
    return;
  }

  await AsyncStorage.removeItem(storageKey(userId));
  dispatchLocalKeyChanged();
}

export function addLocalE2EEKeyChangeListener(listener: LocalKeyChangeListener) {
  localKeyListeners.add(listener);
  return () => localKeyListeners.delete(listener);
}

function dispatchLocalKeyChanged() {
  localKeyListeners.forEach(listener => listener());
}
