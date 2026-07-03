package models

import "time"

const PasswordResetTokenTTL = 30 * time.Minute

type PasswordResetToken struct {
	ID        uint       `gorm:"primarykey"`
	UserID    uint       `gorm:"not null;index"`
	TokenHash string     `gorm:"size:64;uniqueIndex;not null"`
	ExpiresAt time.Time  `gorm:"not null;index"`
	UsedAt    *time.Time `gorm:"index"`
	CreatedAt time.Time

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE"`
}
