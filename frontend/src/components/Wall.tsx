import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../api/axios.js';
import type { Post, ProfileContextType, Comment } from '../types.js';

function Wall() {
    const { user } = useOutletContext<ProfileContextType>();
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
            const res = await api.get('/posts');
            const postsData = res.data.map((p: any) => ({
                ...p,
                likes_count: Number(p.likes_count) || 0,
                comments_count: Number(p.comments_count) || 0
            }));
            setPosts(postsData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchComments = async (postId: number) => {
        try {
            const res = await api.get(`/posts/${postId}/comments`);
            const commentsData = res.data.map((c: any) => ({
                ...c,
                id: Number(c.id),
                postId: Number(c.post_id),
                userId: Number(c.user_id)
            }));
            setComments(prev => ({ ...prev, [postId]: commentsData }));
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
            const res = await api.post('/posts', { content: newPostContent });
            setPosts(prev => [res.data, ...prev]);
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
            const res = await api.patch(`/posts/${postId}`, { content: editContent });
            setPosts(prev => prev.map(p => p.id === postId ? res.data : p));
            setEditingPost(null);
            setEditContent('');
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeletePost = async (postId: number) => {
        if (!confirm('Удалить пост?')) return;
        try {
            await api.delete(`/posts/${postId}`);
            setPosts(prev => prev.filter(p => p.id !== postId));
        } catch (err) {
            console.error(err);
        }
    };

    const handleLike = async (postId: number) => {
        try {
            const response = await api.post(`/posts/${postId}/like`);

            setPosts(prev => prev.map(p =>
                p.id === postId
                    ? {
                        ...p,
                        is_liked: response.data.is_liked,
                        likes_count: response.data.likes_count
                    }
                    : p
            ));
        } catch (error) {
            console.error('Ошибка лайка:', error);
        }
    };

    const handleComment = async (postId: number) => {
        const text = newComment[postId];
        if (!text?.trim()) return;

        try {
            await api.post(`/posts/${postId}/comments`, { content: text });
            setNewComment(prev => ({ ...prev, [postId]: '' }));

            await fetchComments(postId);

            setPosts(prev => prev.map(p =>
                p.id === postId
                    ? { ...p, comments_count: (Number(p.comments_count) || 0) + 1 }
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
        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    if (loading) return <div className="flex justify-center py-12"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;

    return (
        <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
                <form onSubmit={handleCreatePost} className="flex gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 cursor-pointer">
                        {user?.name?.charAt(0).toUpperCase() || '😎'}
                    </div>
                    <div className="flex-1">
                        <textarea
                            value={newPostContent}
                            onChange={e => setNewPostContent(e.target.value)}
                            placeholder="Что у вас нового?"
                            rows={3}
                            maxLength={500}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                        <div className="flex justify-between items-center mt-2">
                            <p className="text-xs text-gray-500">{newPostContent.length}/500</p>
                            <button
                                type="submit"
                                disabled={submitting || !newPostContent.trim()}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
                            >
                                {submitting ? 'Публикация...' : 'Опубликовать'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <div className="space-y-4">
                {posts.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
                        Пока нет постов. Напишите первый!
                    </div>
                ) : (
                    posts.map(post => (
                        <div key={post.id} className="bg-white rounded-xl shadow-sm p-4">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold cursor-pointer">
                                        {post.user?.name?.charAt(0).toUpperCase() || '😎'}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-gray-800">{post.user?.name || 'Пользователь'}</p>
                                        <p className="text-xs text-gray-500">{formatDate(post.created_at)}</p>
                                    </div>
                                </div>
                                {post.user?.id === user?.id && (
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { setEditingPost(post); setEditContent(post.content); }}
                                            className="text-gray-400 hover:text-blue-600 transition cursor-pointer"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => handleDeletePost(post.id)}
                                            className="text-gray-400 hover:text-red-600 transition cursor-pointer"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
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
                                        <button onClick={() => handleEditPost(post.id)} className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm cursor-pointer">Сохранить</button>
                                        <button onClick={() => setEditingPost(null)} className="px-3 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-sm cursor-pointer">Отмена</button>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-gray-700 mb-3 whitespace-pre-wrap">{post.content}</p>
                            )}

                            <div className="flex items-center gap-4 pt-3 border-t border-gray-100">
                                <button onClick={() => handleLike(post.id)} className={`flex items-center gap-1 transition cursor-pointer ${post.is_liked ? 'text-blue-600' : 'text-gray-500 hover:text-blue-600'}`}>
                                    <svg className="w-5 h-5" fill={post.is_liked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                    </svg>
                                    <span className="text-sm">{post.likes_count ?? 0}</span>
                                </button>
                                <button onClick={() => toggleComments(post.id)} className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition cursor-pointer">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                    </svg>
                                    <span className="text-sm">{post.comments_count ?? 0}</span>
                                </button>
                            </div>

                            {openCommentsId === post.id && (
                                <div className="mt-4 pt-4 border-t border-gray-100">
                                    <div className="space-y-3 mb-3">
                                        {comments[post.id]?.map(comment => (
                                            <div key={comment.id} className="flex gap-3">
                                                <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 cursor-pointer">
                                                    {comment.user?.name?.charAt(0).toUpperCase() || '😎'}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="bg-gray-50 rounded-lg p-2">
                                                        <p className="font-semibold text-sm">{comment.user?.name || 'Пользователь'}</p>
                                                        <p className="text-gray-700 text-sm">{comment.content}</p>
                                                    </div>
                                                    <p className="text-xs text-gray-500 mt-1">{formatDate(comment.created_at)}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {(!comments[post.id] || comments[post.id]?.length === 0) && (
                                            <p className="text-center text-gray-500 py-4 text-sm">Пока нет комментариев</p>
                                        )}
                                    </div>
                                    <div className="flex gap-2 mt-3">
                                        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 cursor-pointer">
                                            {user?.name?.charAt(0).toUpperCase() || '😎'}
                                        </div>
                                        <div className="flex-1">
                                            <textarea
                                                value={newComment[post.id] || ''}
                                                onChange={e => setNewComment(prev => ({ ...prev, [post.id]: e.target.value }))}
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