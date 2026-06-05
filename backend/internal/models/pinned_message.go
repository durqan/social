package models

import "time"

type PinnedMessage struct {
	ID             uint      `json:"id" gorm:"primarykey"`
	ConversationID uint      `json:"conversation_id" gorm:"not null;index;uniqueIndex:idx_pinned_messages_conversation"`
	MessageID      uint      `json:"message_id" gorm:"not null;index"`
	PinnedByID     uint      `json:"pinned_by_id" gorm:"not null;index"`
	CreatedAt      time.Time `json:"created_at"`
	Message        Message   `json:"message" gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE;"`
	PinnedBy       User      `json:"pinned_by" gorm:"foreignKey:PinnedByID;constraint:OnDelete:CASCADE;"`
}
