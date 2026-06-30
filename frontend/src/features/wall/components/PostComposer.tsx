import type { FormEvent } from 'react';

import type { User } from "@/shared/types/domain.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

type PostComposerProps = {
    content: string;
    currentUser?: User | null;
    submitting: boolean;
    onContentChange: (content: string) => void;
    onSubmit: (event: FormEvent) => void;
};

export function PostComposer({
    content,
    currentUser,
    submitting,
    onContentChange,
    onSubmit,
}: PostComposerProps) {
    return (
        <div className="app-card app-interactive-card mb-4 p-3 sm:mb-6 sm:p-4">
            <form onSubmit={onSubmit} className="flex items-start gap-3">
                <Avatar
                    name={currentUser?.name}
                    src={currentUser?.avatar}
                    positionX={currentUser?.avatarPositionX}
                    positionY={currentUser?.avatarPositionY}
                    scale={currentUser?.avatarScale}
                    className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                    <textarea
                        value={content}
                        onChange={event => onContentChange(event.target.value)}
                        placeholder="Что у вас нового?"
                        rows={3}
                        maxLength={500}
                        className="app-input min-h-24 w-full resize-none px-4 py-3"
                    />
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">{content.length}/500</p>
                        <button
                            type="submit"
                            disabled={submitting || !content.trim()}
                            className="app-button-primary inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50 sm:w-auto"
                        >
                            <Icon name="send" className="h-4 w-4" />
                            {submitting ? 'Публикация...' : 'Опубликовать'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
