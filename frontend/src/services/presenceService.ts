import api from '../api/axios.js';

export const presenceService = {

    async getPresence(userId: number) {

        const res = await api.get(
            `/users/${userId}/presence`
        );

        return res.data;
    },
};