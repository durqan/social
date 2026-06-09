import { apiRequest } from './http';
import type { ChangePasswordPayload, UpdateProfilePayload, User } from './types';
import { normalizeUser } from './types';

export const userApi = {
  async getProfile() {
    return normalizeUser(await apiRequest<User>('/users/profile'));
  },

  async getUser(userId: number | string) {
    return normalizeUser(await apiRequest<User>(`/users/${userId}`));
  },

  async searchUsers(query: string) {
    const users = await apiRequest<User[]>(
      `/users/search?q=${encodeURIComponent(query)}`,
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
    },
  ) {
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
