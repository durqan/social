package models

import "time"

type Notification struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	RecipientID uint      `json:"recipient_id" gorm:"index"`
	ActorID     uint      `json:"actor_id" gorm:"index"`
	Type        string    `json:"type" gorm:"index"`
	EntityID    uint      `json:"entity_id" gorm:"index"`
	IsRead      bool      `json:"is_read" gorm:"index"`
	CreatedAt   time.Time `json:"created_at" gorm:"index"`

	// CallID is the ephemeral identifier of the call (UUID from client offer).
	// Used for de-duplication in tags and for stale call detection on the client.
	CallID string `json:"call_id" gorm:"size:64;index"`
	// ConversationID is the peer user id to open the chat with (from recipient perspective).
	ConversationID uint `json:"conversation_id" gorm:"index"`
}
