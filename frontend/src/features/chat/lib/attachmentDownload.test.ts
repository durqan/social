import { describe, expect, it } from 'vitest';

import {
    attachmentDisplayName,
    attachmentDownloadFilename,
    attachmentDownloadURL,
} from './attachmentDownload.js';
import type { MessageAttachment } from '@/shared/types/domain.js';

describe('attachment download helpers', () => {
    it('uses original filename from metadata', () => {
        const attachment: MessageAttachment = {
            id: 10,
            file_url: '/api/messages/attachments/10',
            file_type: 'file',
            original_filename: 'report final.pdf',
            content_type: 'application/pdf',
            size: 123,
        };

        expect(attachmentDownloadFilename(attachment)).toBe('report final.pdf');
        expect(attachmentDisplayName(attachment)).toBe('report final.pdf');
    });

    it('uses filename aliases from attachment metadata', () => {
        const attachment = {
            id: 16,
            file_url: '/api/messages/attachments/16',
            file_type: 'file',
            size: 123,
            metadata: {
                filename: 'invoice',
                content_type: 'application/pdf',
            },
        } satisfies MessageAttachment & { metadata: { filename: string; content_type: string } };

        expect(attachmentDownloadFilename(attachment, 'application/pdf')).toBe('invoice.pdf');
        expect(attachmentDisplayName(attachment)).toBe('invoice');
    });

    it('generates names from type and id', () => {
        expect(attachmentDownloadFilename({
            id: 11,
            file_url: '/api/messages/attachments/11',
            file_type: 'image',
            content_type: 'image/webp',
            size: 123,
        })).toBe('image-11.webp');

        expect(attachmentDownloadFilename({
            id: 12,
            file_url: '/api/messages/attachments/12',
            file_type: 'voice',
            content_type: 'audio/ogg',
            size: 123,
        })).toBe('audio-12.ogg');

        expect(attachmentDownloadFilename({
            id: 13,
            file_url: '/api/messages/attachments/13',
            file_type: 'video_note',
            content_type: 'video/mp4',
            size: 123,
        })).toBe('video-note-13.mp4');
    });

    it('uses backend download endpoint for persisted attachments', () => {
        const attachment: MessageAttachment = {
            id: 14,
            file_url: '/api/messages/attachments/14',
            file_type: 'video',
            content_type: 'video/mp4',
            size: 123,
        };

        expect(attachmentDownloadURL(attachment)).toBe('/api/attachments/14/download');
    });

    it('uses explicit download URL before persisted endpoint', () => {
        const attachment = {
            id: 17,
            file_url: '/api/messages/attachments/17',
            downloadUrl: '/signed/download-url',
            file_type: 'file',
            size: 123,
        } satisfies MessageAttachment & { downloadUrl: string };

        expect(attachmentDownloadURL(attachment)).toBe('/signed/download-url');
    });

    it('uses decrypted blob URL when available', () => {
        const attachment: MessageAttachment = {
            id: 15,
            file_url: '/api/messages/attachments/15',
            decrypted_file_url: 'blob:https://app.local/decrypted',
            file_type: 'image',
            original_mime_type: 'image/png',
            size: 123,
        };

        expect(attachmentDownloadURL(attachment)).toBe('blob:https://app.local/decrypted');
        expect(attachmentDownloadFilename(attachment)).toBe('image-15.png');
    });
});
