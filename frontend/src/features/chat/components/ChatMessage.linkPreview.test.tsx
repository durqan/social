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
                hasVideo={false}
                onImport={() => undefined}
            />,
        );

        expect(html).toContain('Preview title');
        expect(html).toContain('https://i.ytimg.com/vi/abc/hqdefault.jpg');
        expect(html).toContain('youtube.com');
        expect(html).toContain('Сохранить видео в чат');
    });
});
