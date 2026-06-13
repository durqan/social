const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type ByteInput = ArrayBuffer | ArrayBufferView | Uint8Array<ArrayBufferLike>;

export function utf8ToBytes(value: string): Uint8Array {
    return textEncoder.encode(value);
}

export function bytesToUtf8(value: ByteInput): string {
    return textDecoder.decode(value);
}

export function bytesToArrayBuffer(value: Uint8Array): ArrayBuffer {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(value);
    return bytes.buffer as ArrayBuffer;
}

export function bytesToBase64(value: ByteInput): string {
    const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function randomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

export function randomNonce(): Uint8Array {
    return randomBytes(12);
}
