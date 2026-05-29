import { apiRequest } from './http';
import type { User } from './types';
import { normalizeUser } from './types';

export const userApi = {
  async getProfile() {
    return normalizeUser(await apiRequest<User>('/users/profile'));
  },

  async getUser(userId: number | string) {
    return normalizeUser(await apiRequest<User>(`/users/${userId}`));
  },
};
