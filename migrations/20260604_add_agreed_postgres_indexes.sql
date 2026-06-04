-- Run this migration outside an explicit transaction because PostgreSQL
-- does not allow CREATE INDEX CONCURRENTLY inside a transaction block.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_name_trgm
ON users USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_trgm
ON users USING gin (email gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_friendships_friend_status_user
ON friendships (friend_id, status, user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_created_at_desc
ON notifications (recipient_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_user_created_at_desc
ON posts (user_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_post_created_at_asc
ON comments (post_id, created_at ASC);
