const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const avatarMaxSize = 5 * 1024 * 1024;
export const chatImageMaxSize = 10 * 1024 * 1024;
export const chatImageMaxCount = 5;

export function formatFileSize(bytes: number) {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} МБ`;
    }

    if (bytes >= 1024) {
        return `${Math.ceil(bytes / 1024)} КБ`;
    }

    return `${bytes} Б`;
}

export function validateImageFile(file: File, maxSize: number) {
    if (!imageTypes.has(file.type)) {
        return 'Поддерживаются только JPG, PNG или WebP.';
    }

    if (file.size > maxSize) {
        return `Файл слишком большой: ${formatFileSize(file.size)}. Максимум ${formatFileSize(maxSize)}.`;
    }

    return '';
}

export function validateChatImages(files: File[]) {
    if (files.length > chatImageMaxCount) {
        return `Можно прикрепить максимум ${chatImageMaxCount} картинок за раз.`;
    }

    for (const file of files) {
        const error = validateImageFile(file, chatImageMaxSize);
        if (error) {
            return `${file.name}: ${error}`;
        }
    }

    return '';
}

export function uploadErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallback;
}
