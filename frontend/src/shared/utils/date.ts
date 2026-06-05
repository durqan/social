export const formatRelativeDate = (value?: string) => {
    if (!value) {
        return 'неизвестно';
    }

    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) {
        return 'неизвестно';
    }

    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diffSeconds < 60) return 'только что';
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} мин назад`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} ч назад`;
    if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)} д назад`;

    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const formatLongDate = (value?: string) => {
    if (!value) {
        return 'Недавно';
    }

    return new Date(value).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
};

export const formatMonthDayDate = (value: string) => (
    new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
);

export const formatTime = (value: string) => (
    new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
);

export function formatLastSeen(value?: string | null) {
    if (!value) return '';

    const date = new Date(value);
    const now = new Date();

    const time = date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
    });

    if (date.toDateString() === now.toDateString()) {
        return `был сегодня в ${time}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
        return `был вчера в ${time}`;
    }

    return `был ${date.toLocaleDateString('ru-RU')} в ${time}`;
}