package models

import "time"

const EmailVerificationTTL = 2 * time.Hour

type EmailVerification struct {
	ID        uint       `gorm:"primarykey"`
	UserID    uint       `gorm:"not null;index"`
	Token     string     `gorm:"size:128;unique;not null;index"`
	ExpiresAt time.Time  `gorm:"not null;index"`
	Used      bool       `gorm:"default:false;index"`
	UsedAt    *time.Time `gorm:"index"`

	CreatedAt time.Time
	UpdatedAt time.Time

	User User `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE"`
}
