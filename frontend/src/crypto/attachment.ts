import type { Message, MessageAttachment } from "@/shared/types/domain.js";
import { base64ToBytes, bytesToBase64, bytesToUtf8, randomNonce, utf8ToBytes } from "@/crypto/encoding.js";
import { importPublicKey, type LocalE2EEKeyBundle } from "@/crypto/masterKey.js";

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

type EncryptAttachmentInput = {
    file: File;
    fileType: AttachmentFileType;
    senderUserId: number;
    recipientUserId: number;
    senderBundle: LocalE2EEKeyBundle;
    recipientPublicKeyBase64: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
};

export type EncryptedAttachmentUpload = {
    encryptedFile: File;
    fields: EncryptedAttachmentFields;
    metadata: AttachmentPlainMetadata;
};

export function isEncryptedAttachment(attachment?: Pick<MessageAttachment, 'encryption_version' | 'encrypted_file_key' | 'file_nonce' | 'encrypted_metadata'> | null): boolean {
    return Boolean(
        attachment &&
        (attachment.encryption_version ?? 0) > 0 &&
        attachment.encrypted_file_key &&
        attachment.file_nonce &&
        attachment.encrypted_metadata,
    );
}

export async function encryptAttachmentForUpload({
    file,
    fileType,
    senderUserId,
    recipientUserId,
    senderBundle,
    recipientPublicKeyBase64,
    width,
    height,
    durationSeconds,
}: EncryptAttachmentInput): Promise<EncryptedAttachmentUpload> {
    const fileKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
    const fileNonce = randomNonce();
    const metadataNonce = randomNonce();
    const fileAAD = attachmentFileAAD(senderUserId, recipientUserId, fileType);
    const metadataAAD = attachmentMetadataAAD(senderUserId, recipientUserId, fileType);
    const encryptedBytes = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: fileNonce, additionalData: fileAAD },
        fileKey,
        await file.arrayBuffer(),
    );
    const metadata: AttachmentPlainMetadata = {
        filename: file.name || defaultAttachmentFilename(fileType),
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        fileType,
        width,
        height,
        durationSeconds,
    };
    const encryptedMetadata = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: metadataNonce, additionalData: metadataAAD },
        fileKey,
        utf8ToBytes(JSON.stringify(metadata)),
    );
    const rawFileKey = await crypto.subtle.exportKey('raw', fileKey);
    const recipientPublicKey = await importPublicKey(recipientPublicKeyBase64);
    const senderWrappedKey = await crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        senderBundle.publicKey,
        rawFileKey,
    );
    const recipientWrappedKey = await crypto.subtle.encrypt(
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
        encryptedFile: new File([encryptedBytes], 'attachment.bin', {
            type: 'application/octet-stream',
            lastModified: Date.now(),
        }),
        fields: {
            encryption_version: 1,
            encrypted_file_key: JSON.stringify(keyEnvelope),
            file_nonce: bytesToBase64(fileNonce),
            encrypted_metadata: JSON.stringify(metadataEnvelope),
        },
        metadata,
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

    const fileKey = await unwrapAttachmentFileKey(attachment, currentUserId, bundle);
    const fileResponse = await fetch(attachment.file_url, {
        credentials: 'include',
    });
    if (!fileResponse.ok) {
        throw new Error('Failed to load encrypted attachment');
    }
    const encryptedBytes = await fileResponse.arrayBuffer();
    const fileType = attachment.file_type;
    const metadata = await decryptAttachmentMetadata(message, attachment, fileKey, fileType);
    const plaintextBytes = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: base64ToBytes(attachment.file_nonce || ''),
            additionalData: attachmentFileAAD(message.from_id, message.to_id, fileType),
        },
        fileKey,
        encryptedBytes,
    );
    const blob = new Blob([plaintextBytes], {
        type: metadata.mimeType || 'application/octet-stream',
    });

    return {
        ...attachment,
        decrypted_file_url: URL.createObjectURL(blob),
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

export async function fileFromDecryptedAttachment(attachment: MessageAttachment): Promise<File> {
    if (!attachment.decrypted_file_url || attachment.decryption_error) {
        throw new Error('Attachment is not decrypted');
    }

    const response = await fetch(attachment.decrypted_file_url);
    if (!response.ok) {
        throw new Error('Failed to read decrypted attachment');
    }
    const blob = await response.blob();
    const type = attachment.original_mime_type || blob.type || 'application/octet-stream';
    const name = attachment.original_filename || defaultAttachmentFilename(attachment.file_type);
    return new File([blob], name, {
        type,
        lastModified: Date.now(),
    });
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
    const rawFileKey = await crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        bundle.privateKey,
        base64ToBytes(wrappedKey),
    );
    return crypto.subtle.importKey('raw', rawFileKey, 'AES-GCM', false, ['decrypt']);
}

async function decryptAttachmentMetadata(
    message: Message,
    attachment: MessageAttachment,
    fileKey: CryptoKey,
    fileType: AttachmentFileType,
): Promise<AttachmentPlainMetadata> {
    const envelope = parseMetadataEnvelope(attachment.encrypted_metadata || '');
    const plaintext = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: base64ToBytes(envelope.nonce),
            additionalData: attachmentMetadataAAD(message.from_id, message.to_id, fileType),
        },
        fileKey,
        base64ToBytes(envelope.data),
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
    if (
        parsed.version !== 1 ||
        parsed.alg !== 'AES-256-GCM' ||
        !parsed.nonce ||
        !parsed.data
    ) {
        throw new Error('Invalid encrypted attachment metadata envelope');
    }
    return parsed as EncryptedAttachmentMetadataEnvelope;
}

function attachmentFileAAD(fromId: number, toId: number, fileType: AttachmentFileType): Uint8Array {
    return utf8ToBytes(`social:e2ee:attachment:file:v1:${fromId}:${toId}:${fileType}`);
}

function attachmentMetadataAAD(fromId: number, toId: number, fileType: AttachmentFileType): Uint8Array {
    return utf8ToBytes(`social:e2ee:attachment:metadata:v1:${fromId}:${toId}:${fileType}`);
}

function defaultAttachmentFilename(fileType: AttachmentFileType): string {
    if (fileType === 'voice') {
        return 'voice-message.webm';
    }
    if (fileType === 'video_note') {
        return 'video-note.webm';
    }
    return 'image.jpg';
}
