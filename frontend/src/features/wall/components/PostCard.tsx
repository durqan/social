import { useEffect, useRef, useState } from 'react';
import type { Comment, Post, User } from "@/shared/types/domain.js";
import { formatRelativeDate } from "@/shared/utils/date.js";
import { Avatar } from "@/shared/ui/Avatar.js";
import { Icon } from "@/shared/ui/Icon.js";

type PostCardProps = {
    post: Post;
    currentUser?: User | null;
    isEditing: boolean;
    editContent: string;
    commentsOpen: boolean;
    comments: Comment[];
    commentDraft: string;
    onStartEdit: (post: Post) => void;
    onEditContentChange: (content: string) => void;
    onSaveEdit: (postId: number) => void;
    onCancelEdit: () => void;
    onDelete: (postId: number) => void;
    onLike: (postId: number) => void;
    onToggleComments: (postId: number) => void;
    onCommentDraftChange: (postId: number, content: string) => void;
    onCreateComment: (postId: number) => void;
    onCommentLike: (commentId: number, postId: number) => void;
    onOpenUser: (userId: number) => void;
};

export function PostCard({
    post,
    currentUser,
    isEditing,
    editContent,
    commentsOpen,
    comments,
    commentDraft,
    onStartEdit,
    onEditContentChange,
    onSaveEdit,
    onCancelEdit,
    onDelete,
    onLike,
    onToggleComments,
    onCommentDraftChange,
    onCreateComment,
    onCommentLike,
    onOpenUser,
}: PostCardProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const canManage = post.user?.id === currentUser?.id;

    useEffect(() => {
        if (!menuOpen) {
            return;
        }

        const close = (event: PointerEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
            }
        };

        window.addEventListener('pointerdown', close);
        window.addEventListener('keydown', closeOnEscape);
        return () => {
            window.removeEventListener('pointerdown', close);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [menuOpen]);

    const sharePost = async () => {
        const url = `${window.location.origin}/users/${post.user?.id}/wall?post=${post.id}`;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: post.user?.name || 'Пост',
                    text: post.content.slice(0, 120),
                    url,
                });
                return;
            }
            await navigator.clipboard.writeText(url);
        } catch {
            // User cancelled native sharing or clipboard is unavailable.
        }
    };

    return (
        <div className="app-card app-interactive-card p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                        name={post.user?.name}
                        src={post.user?.avatar}
                        positionX={post.user?.avatar_position_x}
                        positionY={post.user?.avatar_position_y}
                        scale={post.user?.avatar_scale}
                        ariaLabel={`Открыть профиль ${post.user?.name || 'пользователя'}`}
                        onClick={() => onOpenUser(post.user.id)}
                    />
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-800">{post.user?.name || 'Пользователь'}</p>
                        <p className="text-xs text-gray-500">{formatRelativeDate(post.created_at)}</p>
                    </div>
                </div>

                <div className="relative flex gap-2" ref={menuRef}>
                    {canManage && (
                        <>
                            <button
                                type="button"
                                onClick={() => onStartEdit(post)}
                                className="icon-button h-9 w-9 text-gray-400 hover:text-sky-600"
                                aria-label="Редактировать пост"
                                title="Редактировать"
                            >
                                <Icon name="edit" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onDelete(post.id)}
                                className="icon-button h-9 w-9 text-gray-400 hover:text-red-600"
                                aria-label="Удалить пост"
                                title="Удалить"
                            >
                                <Icon name="delete" />
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        className="icon-button h-9 w-9 text-gray-400"
                        aria-label="Меню поста"
                        title="Меню"
                        onClick={() => setMenuOpen(open => !open)}
                    >
                        <Icon name="more" />
                    </button>
                    {menuOpen && (
                        <div className="app-popover-surface absolute right-0 top-10 z-20 w-48 overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-card)] py-1 shadow-xl">
                            <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-text-primary)] transition hover:bg-gray-50"
                                onClick={() => {
                                    setMenuOpen(false);
                                    void sharePost();
                                }}
                            >
                                <Icon name="share" className="h-4 w-4" />
                                Поделиться
                            </button>
                            {canManage ? (
                                <>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--app-text-primary)] transition hover:bg-gray-50"
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onStartEdit(post);
                                        }}
                                    >
                                        <Icon name="edit" className="h-4 w-4" />
                                        Редактировать
                                    </button>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onDelete(post.id);
                                        }}
                                    >
                                        <Icon name="delete" className="h-4 w-4" />
                                        Удалить
                                    </button>
                                </>
                            ) : null}
                        </div>
                    )}
                </div>
            </div>

            {isEditing ? (
                <div className="mb-3">
                    <textarea
                        value={editContent}
                        onChange={event => onEditContentChange(event.target.value)}
                        rows={3}
                        maxLength={500}
                        className="app-input px-4 py-2 resize-none"
                    />
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => onSaveEdit(post.id)}
                            className="rounded-xl bg-sky-600 px-3 py-1.5 text-sm text-white transition hover:bg-sky-700 cursor-pointer"
                        >
                            Сохранить
                        </button>
                        <button
                            onClick={onCancelEdit}
                            className="rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-gray-800 transition hover:bg-gray-200 cursor-pointer"
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            ) : (
                <p className="text-gray-700 mb-3 whitespace-pre-wrap">{post.content}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                <button
                    onClick={() => onLike(post.id)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition cursor-pointer ${post.is_liked ? 'bg-sky-50 text-sky-600' : 'text-gray-500 hover:bg-gray-50 hover:text-sky-600'}`}
                >
                    <Icon name="heart" className="h-4 w-4" filled={post.is_liked} />
                    <span>{post.likes_count ?? 0}</span>
                </button>
                <button
                    onClick={() => onToggleComments(post.id)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-500 transition hover:bg-gray-50 hover:text-sky-600"
                >
                    <Icon name="messages" className="h-4 w-4" />
                    <span>{post.comments_count ?? 0}</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void sharePost();
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-500 transition hover:bg-gray-50 hover:text-sky-600"
                >
                    <Icon name="share" className="h-4 w-4" />
                    <span>Поделиться</span>
                </button>
            </div>

            {commentsOpen && (
                <div className="mt-4 pt-1">
                    <div className="space-y-3 mb-3">
                        {comments.map(comment => (
                            <div key={comment.id} className="flex gap-2 sm:gap-3">
                                <Avatar
                                    name={comment.user?.name}
                                    src={comment.user?.avatar}
                                    positionX={comment.user?.avatar_position_x}
                                    positionY={comment.user?.avatar_position_y}
                                    scale={comment.user?.avatar_scale}
                                    size="sm"
                                    className="flex-shrink-0"
                                    ariaLabel={`Открыть профиль ${comment.user?.name || 'пользователя'}`}
                                    onClick={() => onOpenUser(comment.user.id)}
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="rounded-xl bg-gray-50 p-2">
                                        <p className="truncate font-semibold text-sm">{comment.user?.name || 'Пользователь'}</p>
                                        <p className="break-words text-gray-700 text-sm">{comment.content}</p>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                        <p className="text-xs text-gray-500">{formatRelativeDate(comment.created_at)}</p>
                                        <button
                                            onClick={() => onCommentLike(comment.id, post.id)}
                                            className={`flex items-center gap-1 text-xs transition cursor-pointer ${comment.is_liked ? 'text-sky-600' : 'text-gray-500 hover:text-sky-600'}`}
                                        >
                                            <Icon name="heart" filled={comment.is_liked} />
                                            <span>{comment.likes_count ?? 0}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2 mt-3">
                        <Avatar
                            name={currentUser?.name}
                            src={currentUser?.avatar}
                            positionX={currentUser?.avatarPositionX}
                            positionY={currentUser?.avatarPositionY}
                            scale={currentUser?.avatarScale}
                            size="sm"
                            className="flex-shrink-0"
                            ariaLabel={`Открыть профиль ${currentUser?.name || 'пользователя'}`}
                            onClick={currentUser?.id ? () => onOpenUser(currentUser.id!) : undefined}
                        />
                        <div className="min-w-0 flex-1">
                            <textarea
                                value={commentDraft}
                                onChange={event => onCommentDraftChange(post.id, event.target.value)}
                                placeholder="Написать комментарий..."
                                rows={2}
                                className="app-input w-full px-4 py-2 resize-none text-sm"
                            />
                            <div className="flex justify-end mt-2">
                                <button
                                    onClick={() => onCreateComment(post.id)}
                                    disabled={!commentDraft.trim()}
                                    className="rounded-xl bg-sky-600 px-4 py-1.5 text-sm text-white transition hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                                >
                                    Отправить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
