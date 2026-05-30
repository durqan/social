import { apiRequest } from './http';
import type { Friendship, User } from './types';
import { normalizeUser } from './types';

export const friendsApi = {
  async getFriendsList() {
    const friends = await apiRequest<User[]>('/users/friends/list');
    return friends.map(normalizeUser);
  },

  async getFriendRequests() {
    return apiRequest<Friendship[]>('/users/friends/requests');
  },

  async getFriendshipStatus(userId: number) {
    const response = await apiRequest<{
      status: Friendship['status'] | 'none';
    }>(`/users/friends/status/${userId}`);
    return response.status;
  },

  async sendFriendRequest(userId: number) {
    await apiRequest<{ message: string }>(`/users/friends/request/${userId}`, {
      method: 'POST',
    });
  },

  async acceptFriendRequest(friendshipId: number) {
    await apiRequest<{ message: string }>(
      `/users/friends/${friendshipId}/accept`,
      {
        method: 'PATCH',
      },
    );
  },

  async removeFriend(friendId: number) {
    await apiRequest<{ message: string }>(`/users/friends/${friendId}`, {
      method: 'DELETE',
    });
  },

  async rejectFriendRequest(requesterId: number) {
    await apiRequest<{ message: string }>(`/users/friends/${requesterId}`, {
      method: 'DELETE',
    });
  },
};
