import { request } from "@/shared/api/axios.js";
import type {User} from "@/shared/types/domain.js";

export type UpdateUserData = {
    name?: string;
    email?: string;
    age?: number;
    bio?: string;
    avatar_position_x?: number;
    avatar_position_y?: number;
    avatar_scale?: number;
};

export type ChangePasswordData = {
    current_password: string;
    new_password: string;
    encrypted_master_key?: string;
};

export const normalizeUser = (user: User): User => ({
    ...user,
    createdAt: user.createdAt ?? user.created_at,
    isEmailVerified: user.isEmailVerified ?? user.is_email_verified ?? false,
    avatarPositionX: user.avatarPositionX ?? user.avatar_position_x ?? 50,
    avatarPositionY: user.avatarPositionY ?? user.avatar_position_y ?? 50,
    avatarScale: user.avatarScale ?? user.avatar_scale ?? 1,
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
