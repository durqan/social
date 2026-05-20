interface AvatarProps {
    name?: string;
    src?: string | null;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-24 h-24 text-2xl',
    xl: 'w-32 h-32 text-3xl',
};

export const Avatar = ({ name, src, size = 'md', className = '' }: AvatarProps) => {
    if (src) {
        return <img src={src} alt={name || 'Avatar'} className={`${sizes[size]} rounded-full object-cover ${className}`} />;
    }

    return (
        <div className={`${sizes[size]} bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold ${className}`}>
            {name?.charAt(0).toUpperCase() || '?'}
        </div>
    );
};
