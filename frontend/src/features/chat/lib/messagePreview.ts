import type { Message } from "@/shared/types/domain.js";

export function messagePreviewText(message?: Message | null) {
    if (!message) {
        return 'Сообщение недоступно';
    }

    const content = message.content?.trim();
    if (content) {
        return content.length > 80 ? `${content.slice(0, 77)}...` : content;
    }

    if (message.attachments?.length) {
        if (message.attachments.some(attachment => attachment.file_type === 'voice')) {
            return 'Голосовое сообщение';
        }
        return 'Вложение';
    }

    return 'Сообщение недоступно';
}

export function messageAuthorName(message?: Message | null) {
    return message?.from?.name || 'Пользователь';
}
