package models

import "time"

type PushSubscription struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	UserID    uint      `json:"user_id" gorm:"index;not null"`
	Endpoint  string    `json:"endpoint" gorm:"uniqueIndex;not null"`
	P256DH    string    `json:"p256dh" gorm:"column:p256dh;not null"`
	Auth      string    `json:"auth" gorm:"not null"`
	CreatedAt time.Time `json:"created_at" gorm:"index"`
	UpdatedAt time.Time `json:"updated_at"`
}
