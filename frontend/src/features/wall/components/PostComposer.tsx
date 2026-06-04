import type { FormEvent } from 'react';

type PostComposerProps = {
    content: string;
    submitting: boolean;
    onContentChange: (content: string) => void;
    onSubmit: (event: FormEvent) => void;
};

export function PostComposer({
    content,
    submitting,
    onContentChange,
    onSubmit,
}: PostComposerProps) {
    return (
        <div className="app-card mb-4 p-3 sm:mb-6 sm:p-4">
            <form onSubmit={onSubmit} className="flex gap-3">
                <div className="flex-1">
                    <textarea
                        value={content}
                        onChange={event => onContentChange(event.target.value)}
                        placeholder="Что у вас нового?"
                        rows={3}
                        maxLength={500}
                        className="app-input w-full px-4 py-2 resize-none"
                    />
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">{content.length}/500</p>
                        <button
                            type="submit"
                            disabled={submitting || !content.trim()}
                            className="w-full rounded-xl bg-sky-600 px-4 py-2 text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer sm:w-auto"
                        >
                            {submitting ? 'Публикация...' : 'Опубликовать'}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
