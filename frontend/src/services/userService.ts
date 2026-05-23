import api from '../api/axios.js';
import type {User} from '../types.js';

export type UpdateUserData = {
    name?: string;
    email?: string;
    age?: number;
    bio?: string;
};

export type ChangePasswordData = {
    current_password: string;
    new_password: string;
};

export const normalizeUser = (user: User): User => ({
    ...user,
    createdAt: user.createdAt ?? user.created_at,
    isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
});

export const userService = {
    async getProfile(): Promise<User> {
        const response = await api.get('/users/profile');
        return normalizeUser(response.data);
    },

    async getUser(userId: number | string): Promise<User> {
        const response = await api.get(`/users/${userId}`);
        return normalizeUser(response.data);
    },

    async searchUsers(query: string): Promise<User[]> {
        const response = await api.get('/users/search', {params: {q: query}});
        return response.data.map(normalizeUser);
    },

    async updateUser(userId: number | string, data: UpdateUserData): Promise<User> {
        const response = await api.patch(`/users/${userId}`, data);
        return normalizeUser(response.data);
    },

    async changePassword(userId: number | string, data: ChangePasswordData): Promise<void> {
        await api.patch(`/users/${userId}/password`, data);
    },

    async uploadAvatar(userId: number, file: File,) {
        const formData = new FormData();

        formData.append('avatar', file,);

        const res = await api.patch(
            `/users/${userId}/avatar`,
            formData, {
                headers: {
                    'Content-Type':
                        'multipart/form-data',
                },
            },
        );
        return res.data;
    }
};
