import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { LinkPreviewCard } from './ChatMessage';

describe('LinkPreviewCard', () => {
    it('renders thumbnail and title when metadata is present', () => {
        const html = renderToStaticMarkup(
            <LinkPreviewCard
                preview={{
                    id: 1,
                    message_id: 10,
                    original_url: 'https://www.youtube.com/watch?v=abc',
                    provider: 'youtube',
                    title: 'Preview title',
                    thumbnail_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
                    status: 'preview',
                    created_at: new Date().toISOString(),
                }}
                onImport={() => undefined}
            />,
        );

        expect(html).toContain('Preview title');
        expect(html).toContain('https://i.ytimg.com/vi/abc/hqdefault.jpg');
        expect(html).toContain('youtube.com');
        expect(html).toContain('Сохранить видео в чат');
    });

    it('does not duplicate media after imported attachment is ready', () => {
        const html = renderToStaticMarkup(
            <LinkPreviewCard
                preview={{
                    id: 2,
                    message_id: 11,
                    original_url: 'https://www.instagram.com/reel/abc/',
                    provider: 'instagram',
                    title: 'Instagram reel',
                    thumbnail_url: 'https://instagram.example/stale.jpg',
                    status: 'ready',
                    video_attachment_id: 44,
                    video_attachment: {
                        id: 44,
                        message_id: 11,
                        file_url: '/api/messages/attachments/44',
                        file_type: 'video',
                        thumbnail_url: '/api/messages/attachments/44/thumbnail',
                        size: 123,
                    },
                    created_at: new Date().toISOString(),
                }}
                onImport={() => undefined}
            />,
        );

        expect(html).toBe('');
    });
});
