package models

import (
	"time"
)

type Comment struct {
	ID        uint      `json:"id" gorm:"primarykey"`
	PostID    uint      `json:"post_id" gorm:"not null;index"`
	UserID    uint      `json:"user_id" gorm:"not null;index"`
	Content   string    `json:"content" gorm:"type:text;not null"`
	CreatedAt time.Time `json:"created_at"`
	User      User      `json:"user" gorm:"foreignKey:UserID"`
}
