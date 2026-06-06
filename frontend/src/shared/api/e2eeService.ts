import { request } from "@/shared/api/axios.js";

export type E2EEStatus = {
    enabled: boolean;
    public_key?: string;
};

export type E2EEBackupResponse = {
    enabled: boolean;
    encrypted_master_key?: string | null;
};

export const e2eeService = {
    async getStatus(userId?: number): Promise<E2EEStatus> {
        return request.get<E2EEStatus>('/e2ee/status', userId ? { params: { user_id: userId } } : undefined);
    },

    async enable(encryptedMasterKey: string): Promise<void> {
        await request.post('/e2ee/enable', { encrypted_master_key: encryptedMasterKey });
    },

    async saveBackup(encryptedMasterKey: string): Promise<void> {
        await request.post('/e2ee/backup', { encrypted_master_key: encryptedMasterKey });
    },

    async getBackup(): Promise<E2EEBackupResponse> {
        return request.get<E2EEBackupResponse>('/e2ee/backup');
    },

    async disable(): Promise<void> {
        await request.post('/e2ee/disable');
    },
};
