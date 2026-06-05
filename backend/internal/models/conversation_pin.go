package models

import "time"

type ConversationPin struct {
	ID             uint      `json:"id" gorm:"primarykey"`
	UserID         uint      `json:"user_id" gorm:"not null;index;uniqueIndex:idx_conversation_pin_user_conversation"`
	ConversationID uint      `json:"conversation_id" gorm:"not null;index;uniqueIndex:idx_conversation_pin_user_conversation"`
	CreatedAt      time.Time `json:"created_at"`
	User           User      `json:"user" gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE;"`
	Conversation   User      `json:"conversation" gorm:"foreignKey:ConversationID;constraint:OnDelete:CASCADE;"`
}
