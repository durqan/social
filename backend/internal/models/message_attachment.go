package models

import "time"

type MessageAttachment struct {
	ID        uint      `json:"id" gorm:"primarykey"`
	MessageID uint      `json:"message_id" gorm:"not null;index"`
	FileURL   string    `json:"file_url" gorm:"type:text;not null"`
	FileType  string    `json:"file_type" gorm:"type:varchar(32);not null"`
	Width     *int      `json:"width,omitempty"`
	Height    *int      `json:"height,omitempty"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}
