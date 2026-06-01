import { useEffect } from 'react';

import { Icon } from "@/shared/ui/Icon.js";

type ImageViewerProps = {
    src: string;
    alt?: string;
    onClose: () => void;
};

export function ImageViewer({ src, alt = 'Изображение', onClose }: ImageViewerProps) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <button
                type="button"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                onClick={onClose}
                aria-label="Закрыть изображение"
            >
                <Icon name="close" className="h-5 w-5" />
            </button>
            <img
                src={src}
                alt={alt}
                className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
                onClick={event => event.stopPropagation()}
            />
        </div>
    );
}
