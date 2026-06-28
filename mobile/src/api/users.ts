import { apiCacheKey, apiRequest } from './http';
import type {
  ChangePasswordPayload,
  UpdateProfilePayload,
  User,
} from './types';
import { normalizeUser } from './types';
import { CHAT_IMAGE_MAX_BYTES } from '../config/env';

type ApiCallOptions = {
  signal?: AbortSignal;
};

export const userApi = {
  async getProfile(options?: ApiCallOptions) {
    return normalizeUser(
      await apiRequest<User>('/users/profile', {
        cacheKey: apiCacheKey('user-profile', 'me'),
        signal: options?.signal,
      }),
    );
  },

  async getUser(userId: number | string, options?: ApiCallOptions) {
    return normalizeUser(
      await apiRequest<User>(`/users/${userId}`, {
        cacheKey: apiCacheKey('user-profile', String(userId)),
        signal: options?.signal,
      }),
    );
  },

  async getUsersBatch(userIds: number[], options?: ApiCallOptions) {
    const uniqueIds = Array.from(new Set(userIds.filter(id => id > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const ids = uniqueIds.join(',');
    const users = await apiRequest<User[]>(`/users/batch?ids=${ids}`, {
      cacheKey: apiCacheKey('users-batch', ids),
      signal: options?.signal,
    });
    return Array.isArray(users) ? users.map(normalizeUser) : [];
  },

  async searchUsers(query: string, options?: ApiCallOptions) {
    const users = await apiRequest<User[]>(
      `/users/search?q=${encodeURIComponent(query)}`,
      {
        cacheKey: apiCacheKey('user-search', query.trim().toLowerCase()),
        signal: options?.signal,
      },
    );
    return Array.isArray(users) ? users.map(normalizeUser) : [];
  },

  async updateProfile(userId: number, payload: UpdateProfilePayload) {
    return normalizeUser(
      await apiRequest<User>(`/users/${userId}`, {
        method: 'PATCH',
        body: payload,
      }),
    );
  },

  async changePassword(userId: number, payload: ChangePasswordPayload) {
    await apiRequest<{ message: string }>(`/users/${userId}/password`, {
      method: 'PATCH',
      body: payload,
    });
  },

  async uploadAvatar(
    userId: number,
    image: {
      uri: string;
      type: string;
      fileName: string;
      fileSize?: number;
    },
  ) {
    if (image.fileSize && image.fileSize > CHAT_IMAGE_MAX_BYTES) {
      throw new Error('Аватар должен быть не больше 10 МБ');
    }

    const formData = new FormData();
    formData.append('avatar', {
      uri: image.uri,
      type: image.type,
      name: image.fileName,
    } as unknown as Blob);

    return apiRequest<{ avatar: string }>(`/users/${userId}/avatar`, {
      method: 'PATCH',
      body: formData,
    });
  },
};
