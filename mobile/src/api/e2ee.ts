import type { E2EEBackupResponse, E2EEStatus } from '@social/shared';

import { apiRequest, toQueryString } from './http';

export type { E2EEBackupResponse, E2EEStatus } from '@social/shared';

export const e2eeApi = {
  getStatus(userId?: number) {
    const query = userId ? toQueryString({ user_id: userId }) : '';
    return apiRequest<E2EEStatus>(`/e2ee/status${query}`);
  },

  async enable(encryptedMasterKey: string) {
    await apiRequest<{ message: string }>('/e2ee/enable', {
      method: 'POST',
      body: { encrypted_master_key: encryptedMasterKey },
    });
  },

  async saveBackup(encryptedMasterKey: string) {
    await apiRequest<{ message: string }>('/e2ee/backup', {
      method: 'POST',
      body: { encrypted_master_key: encryptedMasterKey },
    });
  },

  getBackup() {
    return apiRequest<E2EEBackupResponse>('/e2ee/backup');
  },

  async disable() {
    await apiRequest<{ message: string }>('/e2ee/disable', {
      method: 'POST',
    });
  },
};
