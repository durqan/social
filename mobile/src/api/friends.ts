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
};
