import { apiCacheKey, apiRequest, apiRequestMeta, toQueryString } from './http';
import type { Comment, Post } from './types';

type LikeResponse = {
  is_liked: boolean;
  likes_count: number;
};

type PaginatedPosts = {
  posts: Post[];
  has_more: boolean;
  next_offset?: number;
  stale?: boolean;
};

type ApiCallOptions = {
  signal?: AbortSignal;
};

function normalizePost(post: Post): Post {
  return {
    ...post,
    id: Number(post.id),
    user_id: Number(post.user_id ?? post.user?.id ?? 0),
    content: post.content || '',
    likes_count: Number(post.likes_count) || 0,
    comments_count: Number(post.comments_count) || 0,
    is_liked: Boolean(post.is_liked),
    user: {
      ...post.user,
      id: Number(post.user?.id ?? post.user_id ?? 0),
      name: post.user?.name || 'Пользователь',
      avatar: post.user?.avatar ?? null,
      avatar_position_x: Number(post.user?.avatar_position_x) || 50,
      avatar_position_y: Number(post.user?.avatar_position_y) || 50,
      avatar_scale: Number(post.user?.avatar_scale) || 1,
    },
  };
}

function normalizeComment(comment: Comment): Comment {
  return {
    ...comment,
    id: Number(comment.id),
    post_id: Number(comment.post_id),
    user_id: Number(comment.user_id ?? comment.user?.id ?? 0),
    content: comment.content || '',
    likes_count: Number(comment.likes_count) || 0,
    is_liked: Boolean(comment.is_liked),
    user: {
      ...comment.user,
      id: Number(comment.user?.id ?? comment.user_id ?? 0),
      name: comment.user?.name || 'Пользователь',
      avatar: comment.user?.avatar ?? null,
      avatar_position_x: Number(comment.user?.avatar_position_x) || 50,
      avatar_position_y: Number(comment.user?.avatar_position_y) || 50,
      avatar_scale: Number(comment.user?.avatar_scale) || 1,
    },
  };
}

export const postApi = {
  async getPosts(userId?: number, options?: ApiCallOptions) {
    const page = await this.getPostsPage(userId, undefined, options);
    return page.posts;
  },

  async getPostsPage(
    userId?: number,
    params?: {
      limit?: number;
      offset?: number;
    },
    options?: ApiCallOptions,
  ): Promise<PaginatedPosts> {
    const path = userId ? `/posts/user/${userId}` : '/posts';
    const query = params ? toQueryString(params) : '';
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 20;
    const cacheKey = apiCacheKey(
      'wall-feed',
      `${userId ?? 'me'}:${offset}:${limit}`,
    );
    const result = await apiRequestMeta<Post[] | PaginatedPosts>(
      `${path}${query}`,
      {
        cacheKey,
        signal: options?.signal,
      },
    );
    const response = result.data;

    if (Array.isArray(response)) {
      const posts = response.map(normalizePost);
      return {
        posts,
        has_more: false,
        next_offset: posts.length,
        stale: result.stale,
      };
    }

    const posts = Array.isArray(response.posts)
      ? response.posts.map(normalizePost)
      : [];
    return {
      posts,
      has_more: response.has_more !== false,
      next_offset: response.next_offset ?? offset + posts.length,
      stale: result.stale,
    };
  },

  async createPost(content: string) {
    const post = await apiRequest<Post>('/posts', {
      method: 'POST',
      body: { content },
    });
    return normalizePost(post);
  },

  async updatePost(postId: number, content: string) {
    const post = await apiRequest<Post>(`/posts/${postId}`, {
      method: 'PATCH',
      body: { content },
    });
    return normalizePost(post);
  },

  async deletePost(postId: number) {
    await apiRequest<{ message: string }>(`/posts/${postId}`, {
      method: 'DELETE',
    });
  },

  toggleLike(postId: number) {
    return apiRequest<LikeResponse>(`/posts/${postId}/like`, {
      method: 'POST',
    });
  },

  async getComments(postId: number) {
    const comments = await apiRequest<Comment[]>(`/posts/${postId}/comments`);
    return Array.isArray(comments) ? comments.map(normalizeComment) : [];
  },

  async createComment(postId: number, content: string) {
    const comment = await apiRequest<Comment>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: { content },
    });
    return normalizeComment(comment);
  },

  toggleCommentLike(postId: number, commentId: number) {
    return apiRequest<LikeResponse>(
      `/posts/${postId}/comments/${commentId}/like`,
      {
        method: 'POST',
      },
    );
  },
};
