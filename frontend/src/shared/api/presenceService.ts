import { request } from "@/shared/api/axios.js";

type PresenceResponse = {
    online: boolean;
};

export const presenceService = {

    async getPresence(userId: number): Promise<PresenceResponse> {

        return request.get<PresenceResponse>(`/users/${userId}/presence`);
    },
};
