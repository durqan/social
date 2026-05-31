import { request } from "@/shared/api/axios.js";
import type { User, Friendship } from "@/shared/types/domain.js";
import { normalizeUser } from "@/shared/api/userService.js";

export const friendService = {
    async getFriendsList(): Promise<User[]> {
        return (await request.get<User[]>('/users/friends/list')).map(normalizeUser);
    },

    async getFriendRequests(): Promise<Friendship[]> {
        return request.get<Friendship[]>('/users/friends/requests');
    },

    async getFriendshipStatus(userId: number): Promise<string> {
        return (await request.get<{ status: string }>(`/users/friends/status/${userId}`)).status;
    },

    async sendFriendRequest(userId: number): Promise<void> {
        await request.post(`/users/friends/request/${userId}`);
    },

    async acceptFriendRequest(friendshipId: number): Promise<void> {
        await request.patch(`/users/friends/${friendshipId}/accept`);
    },

    async removeFriend(friendId: number): Promise<void> {
        await request.delete(`/users/friends/${friendId}`);
    },

    async blockUser(userId: number): Promise<void> {
        await request.post(`/users/friends/${userId}/block`);
    }
};
