import { apiCacheKey, apiRequest } from './http';
import type { Friendship, User } from './types';
import { normalizeUser } from './types';

type ApiCallOptions = {
  signal?: AbortSignal;
};

export const friendsApi = {
  async getFriendsList() {
    const friends = await apiRequest<User[]>('/users/friends/list');
    return friends.map(normalizeUser);
  },

  async getFriendRequests() {
    return apiRequest<Friendship[]>('/users/friends/requests');
  },

  async getFriendshipStatus(userId: number, options?: ApiCallOptions) {
    const response = await apiRequest<{
      status: Friendship['status'] | 'none';
    }>(`/users/friends/status/${userId}`, {
      signal: options?.signal,
    });
    return response.status;
  },

  async getFriendshipStatuses(userIds: number[], options?: ApiCallOptions) {
    const uniqueIds = Array.from(new Set(userIds.filter(id => id > 0)));
    if (uniqueIds.length === 0) {
      return {};
    }

    const ids = uniqueIds.join(',');
    const response = await apiRequest<{
      statuses: Record<string, Friendship['status'] | 'none'>;
    }>(`/users/friends/status?ids=${ids}`, {
      cacheKey: apiCacheKey('friend-statuses', ids),
      signal: options?.signal,
    });
    return response.statuses || {};
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

  async blockUser(userId: number) {
    await apiRequest<{ message: string }>(`/users/friends/${userId}/block`, {
      method: 'POST',
    });
  },

  async unblockUser(userId: number) {
    await apiRequest<{ message: string }>(`/users/friends/${userId}`, {
      method: 'DELETE',
    });
  },

  async rejectFriendRequest(requesterId: number) {
    await apiRequest<{ message: string }>(`/users/friends/${requesterId}`, {
      method: 'DELETE',
    });
  },
};
