import { base64ToBytes, bytesToBase64 } from "@/crypto/encoding.js";

const dbName = 'social-e2ee';
const dbVersion = 1;
const keyStoreName = 'keys';

export type LocalE2EEKeyBundle = {
    userId: number;
    masterKey: CryptoKey;
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyBase64: string;
    createdAt: string;
};

type StoredE2EEKeyBundle = LocalE2EEKeyBundle;

let dbPromise: Promise<IDBDatabase> | null = null;

function openKeyDB(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(keyStoreName)) {
                db.createObjectStore(keyStoreName, { keyPath: 'userId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Failed to open E2EE key database'));
    });

    return dbPromise;
}

async function keyStoreTransaction(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await openKeyDB();
    return db.transaction(keyStoreName, mode).objectStore(keyStoreName);
}

export async function generateMasterKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
}

export async function generateMessageKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 3072,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
    );
}

export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
    return bytesToBase64(await crypto.subtle.exportKey('spki', publicKey));
}

export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'spki',
        base64ToBytes(publicKeyBase64),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt'],
    );
}

export async function importPrivateKey(privateKeyBytes: BufferSource): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'pkcs8',
        privateKeyBytes,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt'],
    );
}

export async function importMasterKey(rawMasterKey: BufferSource): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', rawMasterKey, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function createLocalE2EEKeyBundle(userId: number): Promise<LocalE2EEKeyBundle> {
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

export async function saveLocalE2EEKeyBundle(bundle: LocalE2EEKeyBundle): Promise<void> {
    const store = await keyStoreTransaction('readwrite');
    await new Promise<void>((resolve, reject) => {
        const request = store.put(bundle satisfies StoredE2EEKeyBundle);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Failed to save E2EE key bundle'));
    });
    dispatchLocalKeyChanged();
}

export async function getLocalE2EEKeyBundle(userId?: number): Promise<LocalE2EEKeyBundle | null> {
    if (!userId) {
        return null;
    }

    const store = await keyStoreTransaction('readonly');
    return new Promise((resolve, reject) => {
        const request = store.get(userId);
        request.onsuccess = () => resolve((request.result as StoredE2EEKeyBundle | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to read E2EE key bundle'));
    });
}

export async function clearLocalE2EEKeyBundle(userId?: number): Promise<void> {
    if (!userId) {
        return;
    }

    const store = await keyStoreTransaction('readwrite');
    await new Promise<void>((resolve, reject) => {
        const request = store.delete(userId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Failed to delete E2EE key bundle'));
    });
    dispatchLocalKeyChanged();
}

function dispatchLocalKeyChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('e2ee:local-key-changed'));
    }
}
