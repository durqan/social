package models

import "time"

type MessageReaction struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	MessageID uint      `json:"message_id" gorm:"not null;uniqueIndex:idx_message_reactions_message_user;index"`
	UserID    uint      `json:"user_id" gorm:"not null;uniqueIndex:idx_message_reactions_message_user;index"`
	Emoji     string    `json:"emoji" gorm:"type:varchar(16);not null"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Message   Message   `json:"-" gorm:"constraint:OnDelete:CASCADE;"`
	User      User      `json:"-" gorm:"constraint:OnDelete:CASCADE;"`
}

type ReactionSummary struct {
	Emoji       string `json:"emoji"`
	Count       int    `json:"count"`
	ReactedByMe bool   `json:"reacted_by_me"`
}
