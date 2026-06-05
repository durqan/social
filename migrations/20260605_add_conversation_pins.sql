CREATE TABLE IF NOT EXISTS conversation_pins (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT idx_conversation_pin_user_conversation UNIQUE (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_pins_user_id ON conversation_pins(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_pins_conversation_id ON conversation_pins(conversation_id);
