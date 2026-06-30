import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from "@/shared/ui/Icon.js";

type ImageViewerProps = {
    src: string;
    alt?: string;
    onClose: () => void;
    onDownload?: () => void;
};

export function ImageViewer({ src, alt = 'Изображение', onClose, onDownload }: ImageViewerProps) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, []);

    const viewer = (
        <div
            className="image-viewer"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div className="image-viewer__content">
                <div className="image-viewer__actions">
                    {onDownload ? (
                        <button
                            type="button"
                            className="image-viewer__action image-viewer__download"
                            onClick={event => {
                                event.stopPropagation();
                                onDownload();
                            }}
                            aria-label="Скачать изображение"
                            title="Скачать"
                        >
                            <Icon name="download" className="h-5 w-5" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="image-viewer__action image-viewer__close"
                        onClick={event => {
                            event.stopPropagation();
                            onClose();
                        }}
                        aria-label="Закрыть изображение"
                        title="Закрыть"
                    >
                        <Icon name="close" className="h-5 w-5" />
                    </button>
                </div>
                <img
                    src={src}
                    alt={alt}
                    className="image-viewer__image"
                    onClick={event => event.stopPropagation()}
                />
            </div>
        </div>
    );

    if (typeof document === 'undefined') {
        return viewer;
    }

    return createPortal(viewer, document.body);
}
