import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

type AvatarInteractionEvent = MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>;

interface AvatarProps {
    name?: string;
    src?: string | null;
    size?: 'sm' | 'md' | 'list' | 'lg' | 'xl';
    className?: string;
    positionX?: number;
    positionY?: number;
    scale?: number;
    ariaLabel?: string;
    onClick?: (event: AvatarInteractionEvent) => void;
}

const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    list: 'w-12 h-12 text-lg',
    lg: 'w-24 h-24 text-2xl',
    xl: 'w-32 h-32 text-3xl',
};

export const Avatar = ({
    name,
    src,
    size = 'md',
    className = '',
    positionX = 50,
    positionY = 50,
    scale = 1,
    ariaLabel,
    onClick,
}: AvatarProps) => {
    const isClickable = typeof onClick === 'function';
    const baseClassName = `${sizes[size]} inline-flex shrink-0 aspect-square rounded-full overflow-hidden ${isClickable ? 'cursor-pointer outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-sky-500' : ''} ${className}`;
    const content: ReactNode = src ? (
        <img
            src={src}
            alt={name || 'Avatar'}
            className="block h-full w-full object-cover"
            style={{
                objectPosition: `${positionX}% ${positionY}%`,
                transform: `scale(${scale})`,
                transformOrigin: `${positionX}% ${positionY}%`,
            }}
        />
    ) : (
        name?.charAt(0).toUpperCase() || '?'
    );

    const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
        if (!onClick) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onClick(event);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
        if (!onClick || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        onClick(event);
    };

    return (
        <span
            className={src ? baseClassName : `${baseClassName} bg-sky-500 flex items-center justify-center text-white font-bold`}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            aria-label={isClickable ? ariaLabel || `Открыть ${name || 'аватар'}` : undefined}
            onClick={isClickable ? handleClick : undefined}
            onKeyDown={isClickable ? handleKeyDown : undefined}
        >
            {content}
        </span>
    );
};
