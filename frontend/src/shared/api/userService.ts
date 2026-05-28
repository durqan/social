import { request } from "@/shared/api/axios.js";
import type {User} from "@/shared/types/domain.js";

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
        return normalizeUser(await request.get<User>('/users/profile'));
    },

    async getUser(userId: number | string): Promise<User> {
        return normalizeUser(await request.get<User>(`/users/${userId}`));
    },

    async searchUsers(query: string): Promise<User[]> {
        return (await request.get<User[]>('/users/search', { params: { q: query } })).map(normalizeUser);
    },

    async updateUser(userId: number | string, data: UpdateUserData): Promise<User> {
        return normalizeUser(await request.patch<User>(`/users/${userId}`, data));
    },

    async changePassword(userId: number | string, data: ChangePasswordData): Promise<void> {
        await request.patch(`/users/${userId}/password`, data);
    },

    async uploadAvatar(userId: number, file: File,) {
        const formData = new FormData();

        formData.append('avatar', file,);

        return request.patch(
            `/users/${userId}/avatar`,
            formData, {
                headers: {
                    'Content-Type':
                        'multipart/form-data',
                },
            },
        );
    }
};
