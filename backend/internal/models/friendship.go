package models

import (
	"time"
)

type Friendship struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UserID    uint      `gorm:"not null;index:idx_user_friend,unique" json:"user_id"`
	FriendID  uint      `gorm:"not null;index:idx_user_friend,unique" json:"friend_id"`
	Status    string    `gorm:"type:varchar(20);default:'pending'" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User   User `gorm:"foreignKey:UserID" json:"user"`
	Friend User `gorm:"foreignKey:FriendID" json:"friend"`
}
