import type { Message, MessageAttachment } from '../api/types';
import { getCookieHeader } from '../api/http';
import { assetURL } from '../config/env';
import {
  base64ToBytes,
  bytesFromDataUri,
  bytesToBase64,
  bytesToUtf8,
  dataUriFromBytes,
  randomNonce,
  toArrayBuffer,
  utf8ToBytes,
} from './encoding';
import { importPublicKey, type LocalE2EEKeyBundle } from './masterKey';
import { getSubtleCrypto } from './webCrypto';

export type AttachmentFileType = MessageAttachment['file_type'];

export type EncryptedAttachmentFields = {
  encryption_version: 1;
  encrypted_file_key: string;
  file_nonce: string;
  encrypted_metadata: string;
};

type EncryptedAttachmentKeyEnvelope = {
  version: 1;
  keyAlg: 'RSA-OAEP-SHA-256';
  keys: Record<string, string>;
};

type EncryptedAttachmentMetadataEnvelope = {
  version: 1;
  alg: 'AES-256-GCM';
  nonce: string;
  data: string;
};

export type AttachmentPlainMetadata = {
  filename: string;
  mimeType: string;
  size: number;
  fileType: AttachmentFileType;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type LocalAttachmentSource = {
  uri: string;
  type: string;
  fileName: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type EncryptedAttachmentUpload = {
  encryptedUri: string;
  encryptedFileName: string;
  encryptedSize: number;
  fields: EncryptedAttachmentFields;
  metadata: AttachmentPlainMetadata;
  previewUri: string;
};

export function isEncryptedAttachment(
  attachment?: Pick<
    MessageAttachment,
    'encryption_version' | 'encrypted_file_key' | 'file_nonce' | 'encrypted_metadata'
  > | null,
) {
  return Boolean(
    attachment &&
      (attachment.encryption_version ?? 0) > 0 &&
      attachment.encrypted_file_key &&
      attachment.file_nonce &&
      attachment.encrypted_metadata,
  );
}

export async function encryptAttachmentForUpload({
  source,
  fileType,
  senderUserId,
  recipientUserId,
  senderBundle,
  recipientPublicKeyBase64,
}: {
  source: LocalAttachmentSource;
  fileType: AttachmentFileType;
  senderUserId: number;
  recipientUserId: number;
  senderBundle: LocalE2EEKeyBundle;
  recipientPublicKeyBase64: string;
}): Promise<EncryptedAttachmentUpload> {
  const subtle = getSubtleCrypto();
  const fileBytes = await readSourceBytes(source.uri);
  const fileKey = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const fileNonce = randomNonce();
  const metadataNonce = randomNonce();
  const fileAAD = attachmentFileAAD(senderUserId, recipientUserId, fileType);
  const metadataAAD = attachmentMetadataAAD(senderUserId, recipientUserId, fileType);
  const encryptedBytes = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fileNonce), additionalData: toArrayBuffer(fileAAD) },
    fileKey,
    toArrayBuffer(fileBytes),
  );
  const metadata: AttachmentPlainMetadata = {
    filename: source.fileName || defaultAttachmentFilename(fileType),
    mimeType: source.type || 'application/octet-stream',
    size: source.fileSize ?? fileBytes.byteLength,
    fileType,
    width: source.width,
    height: source.height,
    durationSeconds: source.durationSeconds,
  };
  const encryptedMetadata = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(metadataNonce), additionalData: toArrayBuffer(metadataAAD) },
    fileKey,
    toArrayBuffer(utf8ToBytes(JSON.stringify(metadata))),
  );
  const rawFileKey = await subtle.exportKey('raw', fileKey);
  const recipientPublicKey = await importPublicKey(recipientPublicKeyBase64);
  const senderWrappedKey = await subtle.encrypt(
    { name: 'RSA-OAEP' },
    senderBundle.publicKey,
    rawFileKey,
  );
  const recipientWrappedKey = await subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    rawFileKey,
  );
  const keyEnvelope: EncryptedAttachmentKeyEnvelope = {
    version: 1,
    keyAlg: 'RSA-OAEP-SHA-256',
    keys: {
      [String(senderUserId)]: bytesToBase64(senderWrappedKey),
      [String(recipientUserId)]: bytesToBase64(recipientWrappedKey),
    },
  };
  const metadataEnvelope: EncryptedAttachmentMetadataEnvelope = {
    version: 1,
    alg: 'AES-256-GCM',
    nonce: bytesToBase64(metadataNonce),
    data: bytesToBase64(encryptedMetadata),
  };

  return {
    encryptedUri: dataUriFromBytes('application/octet-stream', encryptedBytes),
    encryptedFileName: 'attachment.bin',
    encryptedSize: encryptedBytes.byteLength,
    fields: {
      encryption_version: 1,
      encrypted_file_key: JSON.stringify(keyEnvelope),
      file_nonce: bytesToBase64(fileNonce),
      encrypted_metadata: JSON.stringify(metadataEnvelope),
    },
    metadata,
    previewUri: source.uri,
  };
}

export function withDecryptedAttachmentPreview(
  attachment: MessageAttachment,
  previewUri: string,
  metadata: AttachmentPlainMetadata,
  fields: EncryptedAttachmentFields,
): MessageAttachment {
  return {
    ...attachment,
    ...fields,
    decrypted_file_url: previewUri,
    original_mime_type: metadata.mimeType,
    original_filename: metadata.filename,
    original_size: metadata.size,
    width: attachment.width ?? metadata.width,
    height: attachment.height ?? metadata.height,
    duration_seconds: attachment.duration_seconds ?? metadata.durationSeconds,
    duration: attachment.duration ?? metadata.durationSeconds,
    decryption_error: false,
  };
}

export async function decryptAttachmentForDisplay(
  message: Message,
  attachment: MessageAttachment,
  currentUserId: number,
  bundle: LocalE2EEKeyBundle,
): Promise<MessageAttachment> {
  if (!isEncryptedAttachment(attachment)) {
    return attachment;
  }
  if (attachment.decrypted_file_url && !attachment.decryption_error) {
    return attachment;
  }

  const subtle = getSubtleCrypto();
  const fileKey = await unwrapAttachmentFileKey(attachment, currentUserId, bundle);
  const fileResponse = await fetchWithCookies(assetURL(attachment.file_url));
  if (!fileResponse.ok) {
    throw new Error('Failed to load encrypted attachment');
  }
  const encryptedBytes = await fileResponse.arrayBuffer();
  const fileType = attachment.file_type;
  const metadata = await decryptAttachmentMetadata(message, attachment, fileKey, fileType);
  const plaintextBytes = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(attachment.file_nonce || '')),
      additionalData: toArrayBuffer(attachmentFileAAD(message.from_id, message.to_id, fileType)),
    },
    fileKey,
    encryptedBytes,
  );

  return {
    ...attachment,
    decrypted_file_url: dataUriFromBytes(metadata.mimeType, plaintextBytes),
    original_mime_type: metadata.mimeType,
    original_filename: metadata.filename,
    original_size: metadata.size,
    width: attachment.width ?? metadata.width,
    height: attachment.height ?? metadata.height,
    duration_seconds: attachment.duration_seconds ?? metadata.durationSeconds,
    duration: attachment.duration ?? metadata.durationSeconds,
    decryption_error: false,
  };
}

export async function localSourceFromAttachment(
  attachment: MessageAttachment,
): Promise<LocalAttachmentSource> {
  if (attachment.decrypted_file_url && !attachment.decryption_error) {
    return {
      uri: attachment.decrypted_file_url,
      type: attachment.original_mime_type || fallbackMimeType(attachment.file_type),
      fileName: attachment.original_filename || defaultAttachmentFilename(attachment.file_type),
      fileSize: attachment.original_size || attachment.size,
      width: attachment.width,
      height: attachment.height,
      durationSeconds: attachment.duration_seconds ?? attachment.duration,
    };
  }

  if (attachment.decryption_error) {
    throw new Error('Attachment is not decrypted');
  }

  return {
    uri: assetURL(attachment.file_url),
    type: attachment.original_mime_type || fallbackMimeType(attachment.file_type),
    fileName: attachment.original_filename || defaultAttachmentFilename(attachment.file_type),
    fileSize: attachment.original_size || attachment.size,
    width: attachment.width,
    height: attachment.height,
    durationSeconds: attachment.duration_seconds ?? attachment.duration,
  };
}

async function unwrapAttachmentFileKey(
  attachment: MessageAttachment,
  currentUserId: number,
  bundle: LocalE2EEKeyBundle,
): Promise<CryptoKey> {
  const envelope = parseKeyEnvelope(attachment.encrypted_file_key || '');
  const wrappedKey = envelope.keys[String(currentUserId)];
  if (!wrappedKey) {
    throw new Error('No wrapped attachment key for current user');
  }
  const rawFileKey = await getSubtleCrypto().decrypt(
    { name: 'RSA-OAEP' },
    bundle.privateKey,
    toArrayBuffer(base64ToBytes(wrappedKey)),
  );
  return getSubtleCrypto().importKey('raw', rawFileKey, 'AES-GCM', false, ['decrypt']);
}

async function decryptAttachmentMetadata(
  message: Message,
  attachment: MessageAttachment,
  fileKey: CryptoKey,
  fileType: AttachmentFileType,
): Promise<AttachmentPlainMetadata> {
  const envelope = parseMetadataEnvelope(attachment.encrypted_metadata || '');
  const plaintext = await getSubtleCrypto().decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(base64ToBytes(envelope.nonce)),
      additionalData: toArrayBuffer(attachmentMetadataAAD(message.from_id, message.to_id, fileType)),
    },
    fileKey,
    toArrayBuffer(base64ToBytes(envelope.data)),
  );
  const metadata = JSON.parse(bytesToUtf8(plaintext)) as Partial<AttachmentPlainMetadata>;
  if (!metadata.mimeType || !metadata.filename || !metadata.fileType) {
    throw new Error('Invalid encrypted attachment metadata');
  }
  return metadata as AttachmentPlainMetadata;
}

function parseKeyEnvelope(value: string): EncryptedAttachmentKeyEnvelope {
  const parsed = JSON.parse(value) as Partial<EncryptedAttachmentKeyEnvelope>;
  if (
    parsed.version !== 1 ||
    parsed.keyAlg !== 'RSA-OAEP-SHA-256' ||
    !parsed.keys ||
    typeof parsed.keys !== 'object'
  ) {
    throw new Error('Invalid encrypted attachment key envelope');
  }
  return parsed as EncryptedAttachmentKeyEnvelope;
}

function parseMetadataEnvelope(value: string): EncryptedAttachmentMetadataEnvelope {
  const parsed = JSON.parse(value) as Partial<EncryptedAttachmentMetadataEnvelope>;
  if (parsed.version !== 1 || parsed.alg !== 'AES-256-GCM' || !parsed.nonce || !parsed.data) {
    throw new Error('Invalid encrypted attachment metadata envelope');
  }
  return parsed as EncryptedAttachmentMetadataEnvelope;
}

function attachmentFileAAD(fromId: number, toId: number, fileType: AttachmentFileType) {
  return utf8ToBytes(`social:e2ee:attachment:file:v1:${fromId}:${toId}:${fileType}`);
}

function attachmentMetadataAAD(fromId: number, toId: number, fileType: AttachmentFileType) {
  return utf8ToBytes(`social:e2ee:attachment:metadata:v1:${fromId}:${toId}:${fileType}`);
}

function defaultAttachmentFilename(fileType: AttachmentFileType) {
  if (fileType === 'voice') {
    return 'voice-message.webm';
  }
  if (fileType === 'video_note') {
    return 'video-note.webm';
  }
  return 'image.jpg';
}

function fallbackMimeType(fileType: AttachmentFileType) {
  if (fileType === 'voice') {
    return 'audio/webm';
  }
  if (fileType === 'video_note') {
    return 'video/webm';
  }
  return 'image/jpeg';
}

async function readSourceBytes(uri: string) {
  const dataBytes = bytesFromDataUri(uri);
  if (dataBytes) {
    return dataBytes;
  }

  const response = uri.startsWith('http://') || uri.startsWith('https://')
    ? await fetchWithCookies(uri)
    : await fetch(uri);
  if (!response.ok) {
    throw new Error('Failed to read attachment source');
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchWithCookies(url: string) {
  const cookieHeader = await getCookieHeader();
  return fetch(url, {
    headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
}
