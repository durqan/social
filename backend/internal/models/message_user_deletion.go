package models

import "time"

type MessageUserDeletion struct {
	ID        uint      `json:"id" gorm:"primarykey"`
	MessageID uint      `json:"message_id" gorm:"not null;index;uniqueIndex:idx_message_user_deletions_message_user"`
	UserID    uint      `json:"user_id" gorm:"not null;index;uniqueIndex:idx_message_user_deletions_message_user"`
	DeletedAt time.Time `json:"deleted_at" gorm:"not null;index"`

	Message Message `json:"message" gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE;"`
	User    User    `json:"user" gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE;"`
}
