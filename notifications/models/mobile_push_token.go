package models

import "time"

type MobilePushToken struct {
	ID         uint       `json:"id" gorm:"primaryKey"`
	UserID     uint       `json:"user_id" gorm:"index;not null"`
	Provider   string     `json:"provider" gorm:"size:32;not null"`
	Platform   string     `json:"platform" gorm:"size:32;not null"`
	Token      string     `json:"-" gorm:"type:text;uniqueIndex;not null"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty" gorm:"index"`
	LastSeenAt time.Time  `json:"last_seen_at" gorm:"index"`
	CreatedAt  time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt  time.Time  `json:"updated_at"`
}
