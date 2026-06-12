package models

import (
	"time"
)

type Friendship struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	UserID    uint      `gorm:"not null;index:idx_user_friend,unique;index:idx_friendships_user_status_friend,priority:1;index:idx_friendships_friend_status_user,priority:3" json:"user_id"`
	FriendID  uint      `gorm:"not null;index:idx_user_friend,unique;index:idx_friendships_user_status_friend,priority:3;index:idx_friendships_friend_status_user,priority:1" json:"friend_id"`
	Status    string    `gorm:"type:varchar(20);default:'pending';index:idx_friendships_user_status_friend,priority:2;index:idx_friendships_friend_status_user,priority:2" json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	User   User `gorm:"foreignKey:UserID" json:"user"`
	Friend User `gorm:"foreignKey:FriendID" json:"friend"`
}
