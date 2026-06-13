package models

import "gorm.io/gorm"

type Message struct {
	ID          uint                `json:"id" gorm:"primarykey"`
	FromID      uint                `json:"from_id"`
	ToID        uint                `json:"to_id"`
	Content     string              `json:"content"`
	IsRead      bool                `json:"is_read"`
	DeletedAt   gorm.DeletedAt      `json:"-" gorm:"index"`
	Attachments []MessageAttachment `json:"attachments,omitempty" gorm:"foreignKey:MessageID"`
}

func (Message) TableName() string {
	return "messages"
}

type MessageAttachment struct {
	ID        uint   `json:"id" gorm:"primarykey"`
	MessageID uint   `json:"message_id" gorm:"index"`
	FileType  string `json:"file_type"`
}

func (MessageAttachment) TableName() string {
	return "message_attachments"
}
