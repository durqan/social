import api from '../api/axios.js';
import type { User } from '../types.js';

export type UpdateUserData = {
    name?: string;
    email?: string;
    age?: number;
    bio?: string;
    avatar?: string | null;
};

export type ChangePasswordData = {
    current_password: string;
    new_password: string;
};

export const userService = {
    async getProfile(): Promise<User> {
        const response = await api.get('/users/profile');
        return response.data;
    },

    async getUser(userId: number | string): Promise<User> {
        const response = await api.get(`/users/${userId}`);
        return response.data;
    },

    async searchUsers(query: string): Promise<User[]> {
        const response = await api.get('/users/search', { params: { q: query } });
        return response.data;
    },

    async updateUser(userId: number | string, data: UpdateUserData): Promise<User> {
        const response = await api.patch(`/users/${userId}`, data);
        return response.data;
    },

    async changePassword(userId: number | string, data: ChangePasswordData): Promise<void> {
        await api.patch(`/users/${userId}/password`, data);
    },
};
