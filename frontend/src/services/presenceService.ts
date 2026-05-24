import { request } from '../api/axios.js';

export const presenceService = {

    async getPresence(userId: number) {

        return request.get(`/users/${userId}/presence`);
    },
};
