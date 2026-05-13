import api from '../api/axios.js';
import type { Comment, Post } from '../types.js';

export const postService = {
    async getPosts(): Promise<Post[]> {
        const response = await api.get('/posts');
        return response.data.map((post: Post) => ({
            ...post,
            likes_count: Number(post.likes_count) || 0,
            comments_count: Number(post.comments_count) || 0,
        }));
    },

    async createPost(content: string): Promise<Post> {
        const response = await api.post('/posts', { content });
        return response.data;
    },

    async updatePost(postId: number, content: string): Promise<Post> {
        const response = await api.patch(`/posts/${postId}`, { content });
        return response.data;
    },

    async deletePost(postId: number): Promise<void> {
        await api.delete(`/posts/${postId}`);
    },

    async toggleLike(postId: number): Promise<{ is_liked: boolean; likes_count: number }> {
        const response = await api.post(`/posts/${postId}/like`);
        return response.data;
    },

    async getComments(postId: number): Promise<Comment[]> {
        const response = await api.get(`/posts/${postId}/comments`);
        return response.data.map((comment: Comment) => ({
            ...comment,
            id: Number(comment.id),
            post_id: Number(comment.post_id),
            user_id: Number(comment.user_id),
        }));
    },

    async createComment(postId: number, content: string): Promise<void> {
        await api.post(`/posts/${postId}/comments`, { content });
    },
};
