type KeyUsage = 'encrypt' | 'decrypt' | 'deriveBits' | 'deriveKey' | 'sign' | 'verify' | 'wrapKey' | 'unwrapKey';
type KeyFormat = 'raw' | 'spki' | 'pkcs8' | 'jwk';
type AlgorithmIdentifier =
  | string
  | ({
      name: string;
    } & Record<string, unknown>);

interface CryptoKey {
  readonly algorithm?: unknown;
  readonly extractable?: boolean;
  readonly type?: string;
  readonly usages?: KeyUsage[];
}

interface CryptoKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

interface SubtleCrypto {
  generateKey(
    algorithm: {
      name: 'RSA-OAEP';
    } & Record<string, unknown>,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKeyPair>;
  generateKey(
    algorithm: {
      name: 'AES-GCM';
    } & Record<string, unknown>,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  importKey(
    format: KeyFormat,
    keyData: ArrayBuffer | JsonWebKey,
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  exportKey(format: KeyFormat, key: CryptoKey): Promise<ArrayBuffer>;
  encrypt(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
  decrypt(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

interface Crypto {
  subtle?: SubtleCrypto;
  getRandomValues?<T extends ArrayBufferView>(array: T): T;
}

interface JsonWebKey {
  [key: string]: unknown;
}

declare var crypto: Crypto;
