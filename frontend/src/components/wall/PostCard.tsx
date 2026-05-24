import type { Comment, Post, User } from '../../types.js';
import { formatRelativeDate } from '../../utils/date.js';
import { Avatar } from '../ui/Avatar.js';
import { Icon } from '../ui/Icon.js';

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
}: PostCardProps) {
    return (
        <div className="app-card p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={post.user?.name} className="cursor-pointer" />
                    <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-800">{post.user?.name || 'Пользователь'}</p>
                        <p className="text-xs text-gray-500">{formatRelativeDate(post.created_at)}</p>
                    </div>
                </div>

                {post.user?.id === currentUser?.id && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => onStartEdit(post)}
                            className="text-gray-400 hover:text-sky-600 transition cursor-pointer"
                        >
                            <Icon name="edit" />
                        </button>
                        <button
                            onClick={() => onDelete(post.id)}
                            className="text-gray-400 hover:text-red-600 transition cursor-pointer"
                        >
                            <Icon name="delete" />
                        </button>
                    </div>
                )}
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

            <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
                <button
                    onClick={() => onLike(post.id)}
                    className={`flex items-center gap-1 transition cursor-pointer ${post.is_liked ? 'text-sky-600' : 'text-gray-500 hover:text-sky-600'}`}
                >
                    <Icon name="heart" filled={post.is_liked} />
                    <span className="text-sm">{post.likes_count ?? 0}</span>
                </button>
                <button
                    onClick={() => onToggleComments(post.id)}
                    className="flex items-center gap-1 text-gray-500 hover:text-sky-600 transition cursor-pointer"
                >
                    <Icon name="messages" />
                    <span className="text-sm">{post.comments_count ?? 0}</span>
                </button>
            </div>

            {commentsOpen && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="space-y-3 mb-3">
                        {comments.map(comment => (
                            <div key={comment.id} className="flex gap-2 sm:gap-3">
                                <Avatar name={comment.user?.name} size="sm" className="flex-shrink-0 cursor-pointer" />
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
                        {comments.length === 0 && (
                            <p className="text-center text-gray-500 py-4 text-sm">Пока нет комментариев</p>
                        )}
                    </div>

                    <div className="flex gap-2 mt-3">
                        <Avatar
                            name={currentUser?.name}
                            src={currentUser?.avatar}
                            size="sm"
                            className="flex-shrink-0 cursor-pointer"
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
