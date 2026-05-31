interface AvatarProps {
    name?: string;
    src?: string | null;
    size?: 'sm' | 'md' | 'list' | 'lg' | 'xl';
    className?: string;
}

const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    list: 'w-12 h-12 text-lg',
    lg: 'w-24 h-24 text-2xl',
    xl: 'w-32 h-32 text-3xl',
};

export const Avatar = ({ name, src, size = 'md', className = '' }: AvatarProps) => {
    const baseClassName = `${sizes[size]} shrink-0 aspect-square rounded-full overflow-hidden ${className}`;

    if (src) {
        return <img src={src} alt={name || 'Avatar'} className={`${baseClassName} block object-cover`} />;
    }

    return (
        <div className={`${baseClassName} bg-sky-500 flex items-center justify-center text-white font-bold`}>
            {name?.charAt(0).toUpperCase() || '?'}
        </div>
    );
};
