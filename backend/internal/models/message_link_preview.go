package models

import "time"

const (
	LinkPreviewStatusPreview   = "preview"
	LinkPreviewStatusImporting = "importing"
	LinkPreviewStatusReady     = "ready"
	LinkPreviewStatusFailed    = "failed"
)

type MessageLinkPreview struct {
	ID                uint      `json:"id" gorm:"primarykey"`
	MessageID         uint      `json:"message_id" gorm:"not null;uniqueIndex"`
	OriginalURL       string    `json:"original_url" gorm:"type:text;not null"`
	Provider          string    `json:"provider" gorm:"type:varchar(32);not null;index"`
	Title             *string   `json:"title,omitempty" gorm:"type:text"`
	Description       *string   `json:"description,omitempty" gorm:"type:text"`
	ThumbnailURL      *string   `json:"thumbnail_url,omitempty" gorm:"type:text"`
	DurationSeconds   *int      `json:"duration_seconds,omitempty"`
	Status            string    `json:"status" gorm:"type:varchar(32);not null;default:'preview';index"`
	ImportError       *string   `json:"import_error,omitempty" gorm:"type:text"`
	VideoAttachmentID *uint     `json:"video_attachment_id,omitempty" gorm:"index"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}
