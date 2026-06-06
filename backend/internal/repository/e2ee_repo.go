package repository

import (
	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func GetEncryptedKeyBackupByUserID(db *gorm.DB, userID uint) (*models.EncryptedKeyBackup, error) {
	var backup models.EncryptedKeyBackup
	err := db.Where("user_id = ?", userID).First(&backup).Error
	return &backup, err
}

func UpsertEncryptedKeyBackup(db *gorm.DB, backup *models.EncryptedKeyBackup) error {
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"encrypted_master_key",
			"updated_at",
		}),
	}).Create(backup).Error
}

func DeleteEncryptedKeyBackupByUserID(db *gorm.DB, userID uint) error {
	return db.Where("user_id = ?", userID).Delete(&models.EncryptedKeyBackup{}).Error
}
