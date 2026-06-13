export type E2EEStatus = {
  enabled: boolean;
  public_key?: string;
};

export type E2EEBackupResponse = {
  enabled: boolean;
  encrypted_master_key?: string | null;
};
