import { request } from "@/shared/api/axios.js";
import type {User} from "@/shared/types/domain.js";
import type { ChangePasswordData, UpdateUserData } from '@social/shared';

export type { ChangePasswordData, UpdateUserData } from '@social/shared';

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

    async getUsersBatch(userIds: number[]): Promise<User[]> {
        const ids = Array.from(new Set(userIds.filter(id => id > 0)));
        if (ids.length === 0) {
            return [];
        }

        return (await request.get<User[]>('/users/batch', {
            params: { ids: ids.join(',') },
        })).map(normalizeUser);
    },

    async searchUsers(query: string, options?: { signal?: AbortSignal }): Promise<User[]> {
        return (await request.get<User[]>('/users/search', {
            params: { q: query },
            signal: options?.signal,
        })).map(normalizeUser);
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
