package models

import "time"

type MessageAttachment struct {
	ID                uint      `json:"id" gorm:"primarykey"`
	MessageID         uint      `json:"message_id" gorm:"not null;index"`
	FileURL           string    `json:"file_url" gorm:"type:text;not null"`
	FileType          string    `json:"file_type" gorm:"type:varchar(32);not null"`
	Width             *int      `json:"width,omitempty"`
	Height            *int      `json:"height,omitempty"`
	DurationSeconds   *int      `json:"duration_seconds,omitempty"`
	Size              int64     `json:"size"`
	EncryptionVersion int       `json:"encryption_version" gorm:"not null;default:0;index"`
	EncryptedFileKey  string    `json:"encrypted_file_key,omitempty" gorm:"type:text"`
	FileNonce         string    `json:"file_nonce,omitempty" gorm:"type:text"`
	EncryptedMetadata string    `json:"encrypted_metadata,omitempty" gorm:"type:text"`
	CreatedAt         time.Time `json:"created_at"`
}
