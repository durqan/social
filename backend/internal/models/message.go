package models

import (
	"time"

	"gorm.io/gorm"
)

type Message struct {
	ID                     uint                `json:"id" gorm:"primarykey"`
	FromID                 uint                `json:"from_id" gorm:"not null;index"`
	ToID                   uint                `json:"to_id" gorm:"not null;index"`
	Content                string              `json:"content" gorm:"type:text;not null"`
	IsRead                 bool                `json:"is_read" gorm:"default:false"`
	ReplyToMessageID       *uint               `json:"reply_to_message_id" gorm:"index"`
	ForwardedFromMessageID *uint               `json:"forwarded_from_message_id" gorm:"index"`
	ForwardedFromUserID    *uint               `json:"forwarded_from_user_id" gorm:"index"`
	CreatedAt              time.Time           `json:"created_at"`
	UpdatedAt              time.Time           `json:"updated_at"`
	DeletedAt              gorm.DeletedAt      `json:"-" gorm:"index"`
	From                   User                `json:"from" gorm:"foreignKey:FromID"`
	To                     User                `json:"to" gorm:"foreignKey:ToID"`
	ReplyToMessage         *Message            `json:"reply_to_message" gorm:"foreignKey:ReplyToMessageID;references:ID"`
	ForwardedFromMessage   *Message            `json:"forwarded_from_message" gorm:"foreignKey:ForwardedFromMessageID;references:ID"`
	ForwardedFromUser      *User               `json:"forwarded_from_user" gorm:"foreignKey:ForwardedFromUserID;references:ID"`
	Attachments            []MessageAttachment `json:"attachments,omitempty" gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE;"`
}
