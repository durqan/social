import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

import { postService } from "@/features/wall/api/postService.js";
import { useAppDialog } from "@/app/providers/AppDialogProvider.js";
import {
    notificationService,
    type MarkNotificationsReadPayload,
} from "@/features/notifications/api/notificationService.js";
import type { Comment, Post, ProfileContextType } from "@/shared/types/domain.js";
import { Spinner } from "@/shared/ui/Spinner.js";
import { PostCard } from "@/features/wall/components/PostCard.js";
import { PostComposer } from "@/features/wall/components/PostComposer.js";

const wallPageSize = 20;

const isAbortError = (error: unknown) => {
    return error instanceof Error && (
        error.name === 'AbortError' ||
        error.name === 'CanceledError' ||
        ('code' in error && error.code === 'ERR_CANCELED')
    );
};

function Wall() {
    const navigate = useNavigate();
    const dialog = useAppDialog();
    const { user, isOwner, currentUser } = useOutletContext<ProfileContextType>();
    const userId = user?.id;
    const [posts, setPosts] = useState<Post[]>([]);
    const [newPostContent, setNewPostContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [editingPost, setEditingPost] = useState<Post | null>(null);
    const [editContent, setEditContent] = useState('');
    const [openCommentsId, setOpenCommentsId] = useState<number | null>(null);
    const [comments, setComments] = useState<Record<number, Comment[]>>({});
    const [newComment, setNewComment] = useState<Record<number, string>>({});
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const loadAbortRef = useRef<AbortController | null>(null);
    const nextOffsetRef = useRef(0);

    useEffect(() => {
        if (!isOwner || !currentUser?.id) {
            return;
        }

        const payload: MarkNotificationsReadPayload = {
            types: ['post_liked', 'comment_created'],
        };

        void notificationService.markMatchingAsRead(payload)
            .then(() => {
                window.dispatchEvent(new CustomEvent('notifications:read-matching', {
                    detail: payload,
                }));
            })
            .catch(error => {
                console.error('Ошибка отметки уведомлений стены:', error);
            });
    }, [currentUser?.id, isOwner]);

    const fetchPosts = useCallback(async (mode: 'replace' | 'more' = 'replace') => {
        if (!userId) {
            setPosts([]);
            setHasMore(false);
            nextOffsetRef.current = 0;
            setLoading(false);
            return;
        }

        const offset = mode === 'more' ? nextOffsetRef.current : 0;
        if (mode === 'replace') {
            loadAbortRef.current?.abort();
        }
        const controller = new AbortController();
        loadAbortRef.current = controller;
        setErrorMessage('');
        if (mode === 'more') {
            setLoadingMore(true);
        } else {
            setLoading(true);
        }

        try {
            const page = await postService.getPostsPage(userId, {
                limit: wallPageSize,
                offset,
            }, {
                signal: controller.signal,
            });
            setPosts(prev => {
                if (mode !== 'more') {
                    return page.posts;
                }
                const existingIds = new Set(prev.map(post => post.id));
                const nextPosts = page.posts.filter(post => !existingIds.has(post.id));
                return nextPosts.length ? [...prev, ...nextPosts] : prev;
            });
            setHasMore(page.has_more);
            nextOffsetRef.current = page.next_offset ?? offset + page.posts.length;
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }
            console.error(err);
            setErrorMessage('Не удалось загрузить стену');
        } finally {
            if (loadAbortRef.current === controller) {
                loadAbortRef.current = null;
            }
            if (mode === 'more') {
                setLoadingMore(false);
            } else {
                setLoading(false);
            }
        }
    }, [userId]);

    useEffect(() => {
        fetchPosts();
        return () => {
            loadAbortRef.current?.abort();
        };
    }, [fetchPosts]);

    const fetchComments = async (postId: number) => {
        try {
            const postComments = await postService.getComments(postId);
            setComments(prev => ({ ...prev, [postId]: postComments }));
        } catch (err) {
            console.error(err);
        }
    };

    const toggleComments = (postId: number) => {
        if (openCommentsId === postId) {
            setOpenCommentsId(null);
            return;
        }

        setOpenCommentsId(postId);
        if (!comments[postId]) {
            fetchComments(postId);
        }
    };

    const handleCreatePost = async (event: FormEvent) => {
        event.preventDefault();
        if (!newPostContent.trim()) return;
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            await dialog.alert({
                title: 'Подтвердите email',
                message: 'Подтвердите email, чтобы продолжить.',
                confirmText: 'Понятно',
                icon: 'warning',
            });
            return;
        }

        setSubmitting(true);
        try {
            const post = await postService.createPost(newPostContent);
            setPosts(prev => [post, ...prev]);
            setNewPostContent('');
        } catch (err) {
            console.error(err);
        } finally {
            setSubmitting(false);
        }
    };

    const handleEditPost = async (postId: number) => {
        if (!editContent.trim()) return;

        try {
            const post = await postService.updatePost(postId, editContent);
            setPosts(prev => prev.map(item => item.id === postId ? post : item));
            setEditingPost(null);
            setEditContent('');
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeletePost = async (postId: number) => {
        const ok = await dialog.confirm({
            title: 'Удалить пост?',
            message: 'Пост и связанные с ним данные будут удалены. Это действие нельзя отменить.',
            confirmText: 'Удалить',
            cancelText: 'Отмена',
            variant: 'danger',
        });
        if (!ok) return;

        try {
            await postService.deletePost(postId);
            setPosts(prev => prev.filter(post => post.id !== postId));
        } catch (err) {
            console.error(err);
        }
    };

    const handleLike = async (postId: number) => {
        try {
            const response = await postService.toggleLike(postId);
            setPosts(prev => prev.map(post => (
                post.id === postId
                    ? { ...post, is_liked: response.is_liked, likes_count: response.likes_count }
                    : post
            )));
        } catch (error) {
            console.error('Ошибка лайка:', error);
        }
    };

    const handleCommentLike = async (commentId: number, postId: number) => {
        try {
            const response = await postService.toggleCommentLike(postId, commentId);
            setComments(prev => ({
                ...prev,
                [postId]: prev[postId]?.map(comment => (
                    comment.id === commentId
                        ? { ...comment, is_liked: response.is_liked, likes_count: response.likes_count }
                        : comment
                )) || [],
            }));
        } catch (err) {
            console.error(err);
        }
    };

    const handleComment = async (postId: number) => {
        const text = newComment[postId];
        if (!text?.trim()) return;
        if (!(currentUser?.isEmailVerified ?? currentUser?.is_email_verified ?? false)) {
            await dialog.alert({
                title: 'Подтвердите email',
                message: 'Подтвердите email, чтобы продолжить.',
                confirmText: 'Понятно',
                icon: 'warning',
            });
            return;
        }

        try {
            await postService.createComment(postId, text);
            setNewComment(prev => ({ ...prev, [postId]: '' }));
            await fetchComments(postId);
            setPosts(prev => prev.map(post => (
                post.id === postId
                    ? { ...post, comments_count: (Number(post.comments_count) || 0) + 1 }
                    : post
            )));
        } catch (err) {
            console.error(err);
        }
    };

    const startEditing = (post: Post) => {
        setEditingPost(post);
        setEditContent(post.content);
    };

    const openUserProfile = (userId: number) => {
        navigate(`/users/${userId}`);
    };

    if (loading) {
        return <div className="flex justify-center py-12"><Spinner /></div>;
    }

    return (
        <div className="mx-auto max-w-2xl">
            {isOwner && (
                <PostComposer
                    content={newPostContent}
                    submitting={submitting}
                    onContentChange={setNewPostContent}
                    onSubmit={handleCreatePost}
                />
            )}

            <div className="space-y-3 sm:space-y-4">
                {errorMessage && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {errorMessage}
                    </div>
                )}
                {posts.length === 0 ? (
                    <div className="app-card border-dashed p-6 text-center sm:p-8">
                        <p className="text-base font-semibold text-gray-900">Пока нет постов</p>
                        <p className="mt-1 text-sm text-gray-500">
                            Здесь появятся публикации и обсуждения пользователя.
                        </p>
                    </div>
                ) : (
                    posts.map(post => (
                        <PostCard
                            key={post.id}
                            post={post}
                            currentUser={currentUser}
                            isEditing={editingPost?.id === post.id}
                            editContent={editContent}
                            commentsOpen={openCommentsId === post.id}
                            comments={comments[post.id] || []}
                            commentDraft={newComment[post.id] || ''}
                            onStartEdit={startEditing}
                            onEditContentChange={setEditContent}
                            onSaveEdit={handleEditPost}
                            onCancelEdit={() => setEditingPost(null)}
                            onDelete={handleDeletePost}
                            onLike={handleLike}
                            onToggleComments={toggleComments}
                            onCommentDraftChange={(postId, content) => setNewComment(prev => ({ ...prev, [postId]: content }))}
                            onCreateComment={handleComment}
                            onCommentLike={handleCommentLike}
                            onOpenUser={openUserProfile}
                        />
                    ))
                )}
                {hasMore && (
                    <div className="flex justify-center py-2">
                        <button
                            type="button"
                            className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 disabled:cursor-wait disabled:opacity-60"
                            disabled={loadingMore}
                            onClick={() => fetchPosts('more')}
                        >
                            {loadingMore ? 'Загрузка...' : 'Показать еще'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Wall;
