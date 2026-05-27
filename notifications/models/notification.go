package models

import "time"

type Notification struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	RecipientID uint      `json:"recipient_id" gorm:"index"`
	ActorID     uint      `json:"actor_id" gorm:"index"`
	Type        string    `json:"type" gorm:"index"`
	EntityID    uint      `json:"entity_id" gorm:"index"`
	IsRead      bool      `json:"is_read" gorm:"index"`
	CreatedAt   time.Time `json:"created_at" gorm:"index"`
}
