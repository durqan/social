CREATE TABLE IF NOT EXISTS encrypted_key_backups (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_master_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT idx_encrypted_key_backups_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_key_backups_user_id_lookup
    ON encrypted_key_backups(user_id);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS encryption_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS ciphertext TEXT;

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS nonce TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_encryption_version
    ON messages(encryption_version);
