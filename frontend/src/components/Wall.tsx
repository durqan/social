import {useState, useEffect} from 'react';
import {useOutletContext} from 'react-router-dom';
import type {Post, ProfileContextType, Comment} from '../types.js';
import {postService} from '../services/postService.js';
import {Avatar} from './ui/Avatar.js';
import {Icon} from './ui/Icon.js';
import {Spinner} from './ui/Spinner.js';

function Wall() {
    const {user} = useOutletContext<ProfileContextType>();
    const [posts, setPosts] = useState<Post[]>([]);
    const [newPostContent, setNewPostContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [editingPost, setEditingPost] = useState<Post | null>(null);
    const [editContent, setEditContent] = useState('');
    const [openCommentsId, setOpenCommentsId] = useState<number | null>(null);
    const [comments, setComments] = useState<{ [key: number]: Comment[] }>({});
    const [newComment, setNewComment] = useState<{ [key: number]: string }>({});

    useEffect(() => {
        fetchPosts();
    }, []);

    const fetchPosts = async () => {
        try {
            setPosts(await postService.getPosts());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchComments = async (postId: number) => {
        try {
            const postComments = await postService.getComments(postId);
            setComments(prev => ({...prev, [postId]: postComments}));
        } catch (err) {
            console.error(err);
        }
    };

    const toggleComments = (postId: number) => {
        if (openCommentsId === postId) {
            setOpenCommentsId(null);
        } else {
            setOpenCommentsId(postId);
            if (!comments[postId]) fetchComments(postId);
        }
    };

    const handleCreatePost = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPostContent.trim()) return;
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
            setPosts(prev => prev.map(p => p.id === postId ? post : p));
            setEditingPost(null);
            setEditContent('');
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeletePost = async (postId: number) => {
        if (!confirm('Удалить пост?')) return;
        try {
            await postService.deletePost(postId);
            setPosts(prev => prev.filter(p => p.id !== postId));
        } catch (err) {
            console.error(err);
        }
    };

    const handleLike = async (postId: number) => {
        try {
            const response = await postService.toggleLike(postId);

            setPosts(prev => prev.map(p =>
                p.id === postId
                    ? {
                        ...p,
                        is_liked: response.is_liked,
                        likes_count: response.likes_count
                    }
                    : p
            ));
        } catch (error) {
            console.error('Ошибка лайка:', error);
        }
    };

    const handleCommentLike = async (commentId: number, postId: number) => {
        try {
            const response = await postService.toggleCommentLike(postId,commentId);
            setComments(prev => ({
                ...prev,
                [postId]: prev[postId]?.map(c =>
                    c.id === commentId
                        ? { ...c, is_liked: response.is_liked, likes_count: response.likes_count }
                        : c
                ) || []
            }));
        } catch (err) {
            console.error(err);
        }
    };

    const handleComment = async (postId: number) => {
        const text = newComment[postId];
        if (!text?.trim()) return;

        try {
            await postService.createComment(postId, text);
            setNewComment(prev => ({...prev, [postId]: ''}));

            await fetchComments(postId);

            setPosts(prev => prev.map(p =>
                p.id === postId
                    ? {...p, comments_count: (Number(p.comments_count) || 0) + 1}
                    : p
            ));
        } catch (err) {
            console.error(err);
        }
    };

    const formatDate = (date?: string) => {
        if (!date) return 'неизвестно';
        const d = new Date(date.replace(' ', 'T'));
        if (isNaN(d.getTime())) return 'неизвестно';
        const diff = Math.floor((Date.now() - d.getTime()) / 1000);
        if (diff < 60) return 'только что';
        if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
        if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
        if (diff < 604800) return `${Math.floor(diff / 86400)} д назад`;
        return d.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'});
    };

    if (loading) return <div className="flex justify-center py-12"><Spinner/></div>;

    return (
        <div className="mx-auto max-w-2xl">
            <div className="mb-4 rounded-lg bg-white p-3 shadow-sm sm:mb-6 sm:rounded-xl sm:p-4">
                <form onSubmit={handleCreatePost} className="flex gap-3">
                    <div className="flex-1">
                        <textarea
                            value={newPostContent}
                            onChange={e => setNewPostContent(e.target.value)}
                            placeholder="Что у вас нового?"
                            rows={3}
                            maxLength={500}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-gray-500">{newPostContent.length}/500</p>
                            <button
                                type="submit"
                                disabled={submitting || !newPostContent.trim()}
                                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer sm:w-auto"
                            >
                                {submitting ? 'Публикация...' : 'Опубликовать'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <div className="space-y-3 sm:space-y-4">
                {posts.length === 0 ? (
                    <div className="rounded-lg bg-white p-6 text-center text-gray-500 shadow-sm sm:rounded-xl sm:p-8">
                        Пока нет постов. Напишите первый!
                    </div>
                ) : (
                    posts.map(post => (
                        <div key={post.id} className="rounded-lg bg-white p-3 shadow-sm sm:rounded-xl sm:p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <Avatar name={post.user?.name} className="cursor-pointer"/>
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-gray-800">{post.user?.name || 'Пользователь'}</p>
                                        <p className="text-xs text-gray-500">{formatDate(post.created_at)}</p>
                                    </div>
                                </div>
                                {post.user?.id === user?.id && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                setEditingPost(post);
                                                setEditContent(post.content);
                                            }}
                                            className="text-gray-400 hover:text-blue-600 transition cursor-pointer"
                                        >
                                            <Icon name="edit"/>
                                        </button>
                                        <button
                                            onClick={() => handleDeletePost(post.id)}
                                            className="text-gray-400 hover:text-red-600 transition cursor-pointer"
                                        >
                                            <Icon name="delete"/>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {editingPost?.id === post.id ? (
                                <div className="mb-3">
                                    <textarea
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        rows={3}
                                        maxLength={500}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button onClick={() => handleEditPost(post.id)}
                                                className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm cursor-pointer">Сохранить
                                        </button>
                                        <button onClick={() => setEditingPost(null)}
                                                className="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm cursor-pointer">Отмена
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-gray-700 mb-3 whitespace-pre-wrap">{post.content}</p>
                            )}

                            <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
                                <button onClick={() => handleLike(post.id)}
                                        className={`flex items-center gap-1 transition cursor-pointer ${post.is_liked ? 'text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}>
                                    <Icon name="heart" filled={post.is_liked}/>
                                    <span className="text-sm">{post.likes_count ?? 0}</span>
                                </button>
                                <button onClick={() => toggleComments(post.id)}
                                        className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition cursor-pointer">
                                    <Icon name="messages"/>
                                    <span className="text-sm">{post.comments_count ?? 0}</span>
                                </button>
                            </div>

                            {openCommentsId === post.id && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className="space-y-3 mb-3">
                                        {comments[post.id]?.map(comment => (
                                            <div key={comment.id} className="flex gap-2 sm:gap-3">
                                                <Avatar name={comment.user?.name} size="sm"
                                                        className="flex-shrink-0 cursor-pointer"/>
                                                <div className="min-w-0 flex-1">
                                                    <div className="bg-gray-50 rounded-lg p-2">
                                                        <p className="truncate font-semibold text-sm">{comment.user?.name || 'Пользователь'}</p>
                                                        <p className="break-words text-gray-700 text-sm">{comment.content}</p>
                                                    </div>
                                                    <div className="mt-1 flex items-center justify-between gap-2">
                                                        <p className="text-xs text-gray-500">{formatDate(comment.created_at)}</p>
                                                        <button
                                                            onClick={() => handleCommentLike(comment.id, post.id)}
                                                            className={`flex items-center gap-1 text-xs transition cursor-pointer ${
                                                                comment.is_liked ? 'text-blue-600' : 'text-gray-500 hover:text-blue-600'
                                                            }`}
                                                        >
                                                            <Icon name="heart" filled={comment.is_liked}/>
                                                            <span>{comment.likes_count ?? 0}</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {(!comments[post.id] || comments[post.id]?.length === 0) && (
                                            <p className="text-center text-gray-500 py-4 text-sm">Пока нет
                                                комментариев</p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 mt-3">
                                        <Avatar name={user?.name} src={user?.avatar} size="sm"
                                                className="flex-shrink-0 cursor-pointer"/>
                                        <div className="min-w-0 flex-1">
                                            <textarea
                                                value={newComment[post.id] || ''}
                                                onChange={e => setNewComment(prev => ({
                                                    ...prev,
                                                    [post.id]: e.target.value
                                                }))}
                                                placeholder="Написать комментарий..."
                                                rows={2}
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                                            />
                                            <div className="flex justify-end mt-2">
                                                <button
                                                    onClick={() => handleComment(post.id)}
                                                    disabled={!newComment[post.id]?.trim()}
                                                    className="px-4 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 text-sm cursor-pointer"
                                                >
                                                    Отправить
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

export default Wall;
