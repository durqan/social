package models

import "time"

type Notification struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	RecipientID uint      `json:"recipient_id" gorm:"index;index:idx_notifications_recipient_created,priority:1;index:idx_notifications_recipient_unread_match,priority:1"`
	ActorID     uint      `json:"actor_id" gorm:"index;index:idx_notifications_recipient_unread_match,priority:4"`
	Type        string    `json:"type" gorm:"index;index:idx_notifications_recipient_unread_match,priority:3"`
	EntityID    uint      `json:"entity_id" gorm:"index;index:idx_notifications_recipient_unread_match,priority:5"`
	IsRead      bool      `json:"is_read" gorm:"index;index:idx_notifications_recipient_unread_match,priority:2"`
	CreatedAt   time.Time `json:"created_at" gorm:"index;index:idx_notifications_recipient_created,priority:2,sort:desc"`
	DedupeKey   string    `json:"-" gorm:"size:128;uniqueIndex"`

	// CallID is the ephemeral identifier of the call (UUID from client offer).
	// Used for de-duplication in tags and for stale call detection on the client.
	CallID string `json:"call_id" gorm:"size:64;index"`
	// ConversationID is the peer user id to open the chat with (from recipient perspective).
	ConversationID uint `json:"conversation_id" gorm:"index"`
}
