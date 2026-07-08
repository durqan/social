/* eslint-disable no-bitwise */

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const base64Lookup = new Map<string, number>(
  base64Alphabet.split('').map((char, index) => [char, index]),
);

export type ByteSource = ArrayBuffer | ArrayBufferView;

export function utf8ToBytes(value: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

export function bytesToUtf8(value: ByteSource): string {
  const bytes = bytesFromSource(value);
  const chunks: string[] = [];

  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index];
    let codePoint = first;

    if (first >= 0xf0) {
      codePoint =
        ((first & 0x07) << 18) |
        ((bytes[++index] & 0x3f) << 12) |
        ((bytes[++index] & 0x3f) << 6) |
        (bytes[++index] & 0x3f);
    } else if (first >= 0xe0) {
      codePoint =
        ((first & 0x0f) << 12) |
        ((bytes[++index] & 0x3f) << 6) |
        (bytes[++index] & 0x3f);
    } else if (first >= 0xc0) {
      codePoint = ((first & 0x1f) << 6) | (bytes[++index] & 0x3f);
    }

    if (codePoint > 0xffff) {
      codePoint -= 0x10000;
      chunks.push(
        String.fromCharCode(
          0xd800 + (codePoint >> 10),
          0xdc00 + (codePoint & 0x3ff),
        ),
      );
    } else {
      chunks.push(String.fromCharCode(codePoint));
    }
  }

  return chunks.join('');
}

function bytesFromSource(value: ByteSource): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function toArrayBuffer(value: ByteSource): ArrayBuffer {
  const bytes = bytesFromSource(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function bytesToBase64(value: ByteSource): string {
  const bytes = bytesFromSource(value);
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triple = (first << 16) | (second << 8) | third;

    output += base64Alphabet[(triple >> 18) & 63];
    output += base64Alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? base64Alphabet[(triple >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? base64Alphabet[triple & 63] : '=';
  }

  return output;
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  if (normalized.length % 4 !== 0) {
    throw new Error('Invalid base64 value');
  }

  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  const outputLength = (normalized.length / 4) * 3 - padding;
  const bytes = new Uint8Array(outputLength);
  let byteIndex = 0;

  for (let index = 0; index < normalized.length; index += 4) {
    const first = decodeBase64Char(normalized[index]);
    const second = decodeBase64Char(normalized[index + 1]);
    const third = normalized[index + 2] === '=' ? 0 : decodeBase64Char(normalized[index + 2]);
    const fourth = normalized[index + 3] === '=' ? 0 : decodeBase64Char(normalized[index + 3]);
    const triple = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (byteIndex < outputLength) {
      bytes[byteIndex] = (triple >> 16) & 255;
      byteIndex += 1;
    }
    if (byteIndex < outputLength) {
      bytes[byteIndex] = (triple >> 8) & 255;
      byteIndex += 1;
    }
    if (byteIndex < outputLength) {
      bytes[byteIndex] = triple & 255;
      byteIndex += 1;
    }
  }

  return bytes;
}

function decodeBase64Char(char?: string): number {
  const value = char ? base64Lookup.get(char) : undefined;
  if (value === undefined) {
    throw new Error('Invalid base64 value');
  }
  return value;
}

export function randomBytes(length: number): Uint8Array {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject?.getRandomValues) {
    throw new Error('WebCrypto random generator is unavailable');
  }

  const bytes = new Uint8Array(length);
  cryptoObject.getRandomValues(bytes);
  return bytes;
}

export function randomNonce(): Uint8Array {
  return randomBytes(12);
}

export function dataUriFromBytes(mimeType: string, bytes: ByteSource): string {
  return `data:${mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

export function bytesFromDataUri(uri: string): Uint8Array | null {
  const match = uri.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    return null;
  }

  const encoded = decodeURIComponent(match[3] || '');
  return match[2] ? base64ToBytes(encoded) : utf8ToBytes(encoded);
}
