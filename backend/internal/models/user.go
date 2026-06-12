package models

import (
	"time"
)

type User struct {
	ID              uint       `json:"id" gorm:"primarykey"`
	Name            string     `json:"name" gorm:"not null"`
	Email           string     `json:"email,omitempty" gorm:"not null;unique"`
	Age             int        `json:"age"`
	Password        string     `json:"-" gorm:"not null"`
	Bio             string     `json:"bio" gorm:"type:text"`
	Avatar          string     `json:"avatar" gorm:"type:text"`
	AvatarPositionX float64    `json:"avatar_position_x" gorm:"default:50"`
	AvatarPositionY float64    `json:"avatar_position_y" gorm:"default:50"`
	AvatarScale     float64    `json:"avatar_scale" gorm:"default:1"`
	IsEmailVerified bool       `json:"is_email_verified" gorm:"default:false"`
	CreatedAt       time.Time  `json:"created_at" gorm:"autoCreateTime"`
	LastSeenAt      *time.Time `json:"last_seen_at"`
}
