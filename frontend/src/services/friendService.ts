import api from '../api/axios.js';
import type { User, Friendship } from '../types.js';

export const friendService = {
    async getFriendsList(): Promise<User[]> {
        const response = await api.get('/users/friends/list');
        return response.data;
    },

    async getFriendRequests(): Promise<Friendship[]> {
        const response = await api.get('/users/friends/requests');
        return response.data;
    },

    async getFriendshipStatus(userId: number): Promise<string> {
        const response = await api.get(`/users/friends/status/${userId}`);
        return response.data.status;
    },

    async sendFriendRequest(userId: number): Promise<void> {
        await api.post(`/users/friends/request/${userId}`);
    },

    async acceptFriendRequest(friendshipId: number): Promise<void> {
        await api.patch(`/users/friends/${friendshipId}/accept`);
    },

    async removeFriend(friendId: number | undefined): Promise<void> {
        await api.delete(`/users/friends/${friendId}`);
    },

    async blockUser(userId: number): Promise<void> {
        await api.post(`/users/friends/${userId}/block`);
    }
};