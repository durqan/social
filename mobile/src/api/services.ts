import { apiRequest } from './client';
import type { AuthResponse, Comment, Conversation, Friendship, Message, MessageAttachment, Post, User } from '../types';

const normalizeUser = (user: User): User => ({
  ...user,
  createdAt: user.createdAt ?? user.created_at,
  isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
});

export const authApi = {
  async login(email: string, password: string) {
    const response = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    return { ...response, user: normalizeUser(response.user) };
  },
  async register(name: string, email: string, password: string) {
    const response = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { name, email, password },
    });
    return { ...response, user: normalizeUser(response.user) };
  },
  async logout() {
    await apiRequest('/auth/logout', { method: 'POST' });
  },
  sendVerificationEmail: () => apiRequest<{ message: string }>('/auth/send-verification', { method: 'POST' }),
};

export const userApi = {
  async profile() {
    return normalizeUser(await apiRequest<User>('/users/profile'));
  },
  async get(userId: number | string) {
    return normalizeUser(await apiRequest<User>(`/users/${userId}`));
  },
  async update(userId: number | string, data: Partial<User>) {
    return normalizeUser(await apiRequest<User>(`/users/${userId}`, { method: 'PATCH', body: data }));
  },
  async search(query: string) {
    const users = await apiRequest<User[]>(`/users/search?q=${encodeURIComponent(query)}`);
    return users.map(normalizeUser);
  },
  async uploadAvatar(userId: number, uri: string) {
    const form = new FormData();
    form.append('avatar', {
      uri,
      name: 'avatar.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
    return apiRequest<{ avatar: string }>(`/users/${userId}/avatar`, { method: 'PATCH', body: form });
  },
};

export const postApi = {
  async list(userId?: number) {
    return apiRequest<Post[]>(userId ? `/posts/user/${userId}` : '/posts');
  },
  async create(content: string) {
    return apiRequest<Post>('/posts', { method: 'POST', body: { content } });
  },
  async like(postId: number) {
    return apiRequest<{ is_liked: boolean; likes_count: number }>(`/posts/${postId}/like`, { method: 'POST' });
  },
  comments: (postId: number) => apiRequest<Comment[]>(`/posts/${postId}/comments`),
  comment: (postId: number, content: string) =>
    apiRequest(`/posts/${postId}/comments`, { method: 'POST', body: { content } }),
  likeComment: (postId: number, commentId: number) =>
    apiRequest<{ is_liked: boolean; likes_count: number }>(`/posts/${postId}/comments/${commentId}/like`, { method: 'POST' }),
};

export const friendApi = {
  list: () => apiRequest<User[]>('/users/friends/list'),
  requests: () => apiRequest<Friendship[]>('/users/friends/requests'),
  accept: (id: number) => apiRequest(`/users/friends/${id}/accept`, { method: 'PATCH' }),
  remove: (id: number) => apiRequest(`/users/friends/${id}`, { method: 'DELETE' }),
  send: (id: number) => apiRequest(`/users/friends/request/${id}`, { method: 'POST' }),
};

export const messageApi = {
  conversations: () => apiRequest<Conversation[]>('/messages/conversations'),
  withUser: (userId: number | string) =>
    apiRequest<{ messages: Message[]; has_more: boolean }>(`/messages/with/${userId}`),
  send: (userId: number | string, content: string, attachments: MessageAttachment[] = []) =>
    apiRequest<Message>(`/messages/send/${userId}`, { method: 'POST', body: { content, attachments } }),
  markRead: (userId: number | string) => apiRequest(`/messages/read/${userId}`, { method: 'PATCH' }),
  async uploadImage(uri: string) {
    const form = new FormData();
    form.append('image', {
      uri,
      name: 'message.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);
    return apiRequest<MessageAttachment>('/messages/upload', { method: 'POST', body: form });
  },
};
