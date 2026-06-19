package models

import "time"

type EncryptedKeyBackup struct {
	ID                 uint      `json:"id" gorm:"primarykey"`
	UserID             uint      `json:"user_id" gorm:"not null;uniqueIndex:ux_e2ee_backup_user"`
	EncryptedMasterKey string    `json:"encrypted_master_key" gorm:"type:text;not null"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	User               User      `json:"user" gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE;"`
}
