import { request } from "@/shared/api/axios.js";
import type { Comment, Post } from "@/shared/types/domain.js";

export const postService = {
    async getPosts(userId?: number): Promise<Post[]> {
        const posts = await request.get<Post[]>(userId ? `/posts/user/${userId}` : '/posts');
        return posts.map((post: Post) => ({
            ...post,
            likes_count: Number(post.likes_count) || 0,
            comments_count: Number(post.comments_count) || 0,
        }));
    },

    async createPost(content: string): Promise<Post> {
        return request.post<Post>('/posts', { content });
    },

    async toggleCommentLike(postId: number, commentId: number): Promise<{ is_liked: boolean; likes_count: number }> {
        return request.post<{ is_liked: boolean; likes_count: number }>(`/posts/${postId}/comments/${commentId}/like`);
    },

    async updatePost(postId: number, content: string): Promise<Post> {
        return request.patch<Post>(`/posts/${postId}`, { content });
    },

    async deletePost(postId: number): Promise<void> {
        await request.delete(`/posts/${postId}`);
    },

    async toggleLike(postId: number): Promise<{ is_liked: boolean; likes_count: number }> {
        return request.post<{ is_liked: boolean; likes_count: number }>(`/posts/${postId}/like`);
    },

    async getComments(postId: number): Promise<Comment[]> {
        const comments = await request.get<Comment[]>(`/posts/${postId}/comments`);
        return comments.map((comment: Comment) => ({
            ...comment,
            id: Number(comment.id),
            post_id: Number(comment.post_id),
            user_id: Number(comment.user_id),
        }));
    },

    async createComment(postId: number, content: string): Promise<void> {
        await request.post(`/posts/${postId}/comments`, { content });
    },
};
