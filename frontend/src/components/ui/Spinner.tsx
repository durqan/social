export const Spinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
    const className = {
        sm: 'w-5 h-5 border-2',
        md: 'w-8 h-8 border-4',
        lg: 'w-12 h-12 border-4',
    }[size];

    return <div className={`${className} border-blue-500 border-t-transparent rounded-full animate-spin`} />;
};
