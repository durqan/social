package models

import "time"

const (
	CallTypeAudio = "audio"
	CallTypeVideo = "video"

	CallStatusRinging  = "ringing"
	CallStatusAccepted = "accepted"
	CallStatusRejected = "rejected"
	CallStatusTimeout  = "timeout"
	CallStatusEnded    = "ended"
	CallStatusFailed   = "failed"
	CallStatusReplaced = "replaced"
)

type CallLog struct {
	ID              uint       `json:"id" gorm:"primarykey"`
	CallID          string     `json:"-" gorm:"size:128;not null;uniqueIndex"`
	ConversationID  *uint      `json:"conversation_id,omitempty" gorm:"index"`
	CallerID        uint       `json:"caller_id" gorm:"not null;index;index:idx_call_logs_caller_callee_status_started,priority:1;index:idx_call_logs_callee_caller_status_started,priority:2"`
	CalleeID        uint       `json:"callee_id" gorm:"not null;index;index:idx_call_logs_caller_callee_status_started,priority:2;index:idx_call_logs_callee_caller_status_started,priority:1"`
	CallType        string     `json:"call_type" gorm:"type:varchar(20);not null"`
	Status          string     `json:"status" gorm:"type:varchar(20);not null;index;index:idx_call_logs_caller_callee_status_started,priority:3;index:idx_call_logs_callee_caller_status_started,priority:3"`
	StartedAt       time.Time  `json:"started_at" gorm:"not null;index:idx_call_logs_caller_callee_status_started,priority:4,sort:desc;index:idx_call_logs_callee_caller_status_started,priority:4,sort:desc"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty" gorm:"index"`
	AcceptedAt      *time.Time `json:"accepted_at,omitempty"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	DurationSeconds int        `json:"duration_seconds" gorm:"not null;default:0"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	Caller User `json:"caller" gorm:"foreignKey:CallerID;constraint:OnDelete:CASCADE;"`
	Callee User `json:"callee" gorm:"foreignKey:CalleeID;constraint:OnDelete:CASCADE;"`
}
