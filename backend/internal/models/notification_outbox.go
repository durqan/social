package models

import "time"

type NotificationOutbox struct {
	ID             uint       `json:"id" gorm:"primaryKey"`
	Action         string     `json:"action" gorm:"size:64;not null;default:create;index"`
	RecipientID    uint       `json:"recipient_id" gorm:"not null;index"`
	ActorID        uint       `json:"actor_id" gorm:"index"`
	Type           string     `json:"type" gorm:"size:64;not null;index"`
	EntityID       uint       `json:"entity_id" gorm:"index"`
	CallID         string     `json:"call_id" gorm:"size:64;index"`
	ConversationID uint       `json:"conversation_id" gorm:"index"`
	CallType       string     `json:"call_type" gorm:"size:20"`
	DedupeKey      string     `json:"-" gorm:"size:128;uniqueIndex"`
	Status         string     `json:"status" gorm:"size:32;not null;default:pending;index"`
	Attempts       int        `json:"attempts" gorm:"not null;default:0;index"`
	LastError      string     `json:"last_error,omitempty" gorm:"type:text"`
	NextAttemptAt  time.Time  `json:"next_attempt_at" gorm:"not null;index"`
	LeaseToken     string     `json:"-" gorm:"size:64;index"`
	LeaseUntil     *time.Time `json:"lease_until,omitempty" gorm:"index"`
	PublishedAt    *time.Time `json:"published_at,omitempty" gorm:"index"`
	CreatedAt      time.Time  `json:"created_at" gorm:"index"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
