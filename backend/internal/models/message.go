package models

import (
	"time"

	"gorm.io/gorm"
)

type Message struct {
	ID                     uint                `json:"id" gorm:"primarykey;index:idx_messages_pair_created_id,priority:5,sort:desc"`
	FromID                 uint                `json:"from_id" gorm:"not null;index;index:idx_messages_pair_created_id,priority:1;index:idx_messages_from_to_unread,priority:1;index:idx_messages_from_created_active,priority:1;index:idx_messages_to_unread_active,priority:4"`
	ToID                   uint                `json:"to_id" gorm:"not null;index;index:idx_messages_pair_created_id,priority:2;index:idx_messages_from_to_unread,priority:2;index:idx_messages_to_unread_active,priority:1;index:idx_messages_to_created_active,priority:1"`
	Content                string              `json:"content" gorm:"type:text;not null"`
	EncryptionVersion      int                 `json:"encryption_version" gorm:"not null;default:0;index"`
	Ciphertext             string              `json:"ciphertext,omitempty" gorm:"type:text"`
	Nonce                  string              `json:"nonce,omitempty" gorm:"type:text"`
	IsRead                 bool                `json:"is_read" gorm:"default:false;index:idx_messages_from_to_unread,priority:3;index:idx_messages_to_unread_active,priority:2"`
	ReactionVersion        uint64              `json:"reaction_version" gorm:"not null;default:0"`
	ReplyToMessageID       *uint               `json:"reply_to_message_id" gorm:"index"`
	ForwardedFromMessageID *uint               `json:"forwarded_from_message_id" gorm:"index"`
	ForwardedFromUserID    *uint               `json:"forwarded_from_user_id" gorm:"index"`
	DeletedForEveryoneBy   *uint               `json:"deleted_for_everyone_by,omitempty" gorm:"column:deleted_for_everyone_by;index"`
	CreatedAt              time.Time           `json:"created_at" gorm:"index:idx_messages_pair_created_id,priority:4,sort:desc;index:idx_messages_from_created_active,priority:3,sort:desc;index:idx_messages_to_created_active,priority:3,sort:desc"`
	UpdatedAt              time.Time           `json:"updated_at"`
	DeletedAt              gorm.DeletedAt      `json:"-" gorm:"index;index:idx_messages_pair_created_id,priority:3;index:idx_messages_to_unread_active,priority:3;index:idx_messages_from_created_active,priority:2;index:idx_messages_to_created_active,priority:2"`
	From                   User                `json:"from" gorm:"foreignKey:FromID"`
	To                     User                `json:"to" gorm:"foreignKey:ToID"`
	ReplyToMessage         *Message            `json:"reply_to_message" gorm:"foreignKey:ReplyToMessageID;references:ID"`
	ForwardedFromMessage   *Message            `json:"forwarded_from_message" gorm:"foreignKey:ForwardedFromMessageID;references:ID"`
	ForwardedFromUser      *User               `json:"forwarded_from_user" gorm:"foreignKey:ForwardedFromUserID;references:ID"`
	Attachments            []MessageAttachment `json:"attachments,omitempty" gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE;"`
	Reactions              []ReactionSummary   `json:"reactions,omitempty" gorm:"-"`
}
