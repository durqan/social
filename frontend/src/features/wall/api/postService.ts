import { request } from "@/shared/api/axios.js";
import type { Comment, Post } from "@/shared/types/domain.js";

type PaginatedPostsResponse = {
    posts: Post[];
    has_more: boolean;
    next_offset?: number;
};

type ApiCallOptions = {
    signal?: AbortSignal;
};

const normalizePost = (post: Post): Post => ({
    ...post,
    likes_count: Number(post.likes_count) || 0,
    comments_count: Number(post.comments_count) || 0,
});

export const postService = {
    async getPosts(userId?: number): Promise<Post[]> {
        const posts = await request.get<Post[]>(userId ? `/posts/user/${userId}` : '/posts');
        return posts.map(normalizePost);
    },

    async getPostsPage(
        userId: number | undefined,
        params: { limit: number; offset: number },
        options?: ApiCallOptions,
    ): Promise<PaginatedPostsResponse> {
        const response = await request.get<Post[] | PaginatedPostsResponse>(
            userId ? `/posts/user/${userId}` : '/posts',
            {
                params,
                signal: options?.signal,
            },
        );

        if (Array.isArray(response)) {
            return {
                posts: response.map(normalizePost),
                has_more: false,
                next_offset: response.length,
            };
        }

        const posts = Array.isArray(response.posts)
            ? response.posts.map(normalizePost)
            : [];
        return {
            posts,
            has_more: response.has_more,
            next_offset: response.next_offset ?? params.offset + posts.length,
        };
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
