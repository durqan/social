package models

import (
	"time"
)

type User struct {
	ID              uint      `json:"id" gorm:"primarykey"`
	Name            string    `json:"name" gorm:"not null"`
	Email           string    `json:"email" gorm:"not null;unique"`
	Age             int       `json:"age"`
	Password        string    `json:"-" gorm:"not null"`
	Bio             string    `json:"bio" gorm:"type:text"`
	Avatar          string    `json:"avatar" gorm:"type:text"`
	IsEmailVerified bool      `json:"is_email_verified" gorm:"default:false"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
}
