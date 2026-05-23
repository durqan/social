package models

import "time"

type Message struct {
	ID          uint                `json:"id" gorm:"primarykey"`
	FromID      uint                `json:"from_id" gorm:"not null;index"`
	ToID        uint                `json:"to_id" gorm:"not null;index"`
	Content     string              `json:"content" gorm:"type:text;not null"`
	IsRead      bool                `json:"is_read" gorm:"default:false"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
	From        User                `json:"from" gorm:"foreignKey:FromID"`
	To          User                `json:"to" gorm:"foreignKey:ToID"`
	Attachments []MessageAttachment `json:"attachments,omitempty" gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE;"`
}
