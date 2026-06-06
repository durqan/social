ALTER TABLE message_attachments
    ADD COLUMN IF NOT EXISTS encryption_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS encrypted_file_key TEXT,
    ADD COLUMN IF NOT EXISTS file_nonce TEXT,
    ADD COLUMN IF NOT EXISTS encrypted_metadata TEXT;

CREATE INDEX IF NOT EXISTS idx_message_attachments_encryption_version
    ON message_attachments (encryption_version);
