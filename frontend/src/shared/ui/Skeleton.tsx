type SkeletonBlockProps = {
    className?: string;
};

export function SkeletonBlock({ className = '' }: SkeletonBlockProps) {
    return <span className={`skeleton-block ${className}`} aria-hidden="true" />;
}

export function ConversationsSkeleton({ count = 6 }: { count?: number }) {
    return (
        <div className="app-card overflow-hidden" aria-label="Загружаем диалоги">
            {Array.from({ length: count }).map((_, index) => (
                <div key={index} className="skeleton-row border-b border-[var(--app-border)] p-3 last:border-b-0 sm:p-4">
                    <SkeletonBlock className="h-12 w-12 rounded-full" />
                    <span className="min-w-0 flex-1 space-y-2">
                        <SkeletonBlock className="h-4 w-2/5 rounded-full" />
                        <SkeletonBlock className="h-3 w-4/5 rounded-full" />
                    </span>
                    <SkeletonBlock className="h-3 w-12 rounded-full" />
                </div>
            ))}
        </div>
    );
}

export function FriendsSkeleton({ count = 5 }: { count?: number }) {
    return (
        <div className="space-y-2" aria-label="Загружаем друзей">
            {Array.from({ length: count }).map((_, index) => (
                <div key={index} className="skeleton-row rounded-xl p-3">
                    <SkeletonBlock className="h-12 w-12 rounded-full" />
                    <span className="min-w-0 flex-1 space-y-2">
                        <SkeletonBlock className="h-4 w-1/3 rounded-full" />
                        <SkeletonBlock className="h-3 w-1/2 rounded-full" />
                    </span>
                </div>
            ))}
        </div>
    );
}

export function ProfileSkeleton() {
    return (
        <div className="mx-auto max-w-2xl" aria-label="Загружаем профиль">
            <div className="app-card overflow-hidden">
                <SkeletonBlock className="h-28 w-full rounded-none sm:h-32" />
                <div className="px-4 pb-6 pt-5 sm:px-6">
                    <SkeletonBlock className="mb-4 h-24 w-24 rounded-full" />
                    <SkeletonBlock className="h-7 w-1/2 rounded-full" />
                    <SkeletonBlock className="mt-3 h-4 w-2/3 rounded-full" />
                    <SkeletonBlock className="mt-6 h-16 w-full rounded-2xl" />
                </div>
            </div>
        </div>
    );
}

export function WallSkeleton({ count = 3 }: { count?: number }) {
    return (
        <div className="mx-auto max-w-2xl space-y-4" aria-label="Загружаем стену">
            <div className="app-card p-4">
                <div className="skeleton-row">
                    <SkeletonBlock className="h-10 w-10 rounded-full" />
                    <SkeletonBlock className="h-20 flex-1 rounded-2xl" />
                </div>
            </div>
            {Array.from({ length: count }).map((_, index) => (
                <div key={index} className="app-card p-4">
                    <div className="skeleton-row">
                        <SkeletonBlock className="h-10 w-10 rounded-full" />
                        <span className="min-w-0 flex-1 space-y-2">
                            <SkeletonBlock className="h-4 w-1/3 rounded-full" />
                            <SkeletonBlock className="h-3 w-24 rounded-full" />
                        </span>
                    </div>
                    <SkeletonBlock className="mt-4 h-4 w-full rounded-full" />
                    <SkeletonBlock className="mt-2 h-4 w-4/5 rounded-full" />
                    <div className="mt-4 flex gap-2">
                        <SkeletonBlock className="h-8 w-20 rounded-full" />
                        <SkeletonBlock className="h-8 w-24 rounded-full" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ChatMessagesSkeleton({ count = 8 }: { count?: number }) {
    return (
        <div className="chat-doodle-bg flex h-full flex-col justify-end gap-2 p-3 sm:p-4" aria-label="Загружаем сообщения">
            {Array.from({ length: count }).map((_, index) => {
                const own = index % 3 !== 0;
                return (
                    <div key={index} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                        <SkeletonBlock className={`h-10 rounded-[18px] ${own ? 'w-3/5' : 'w-1/2'}`} />
                    </div>
                );
            })}
        </div>
    );
}
