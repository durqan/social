ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_seen_at
    ON users (last_seen_at DESC);