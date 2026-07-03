package repository

import (
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

func CreatePasswordResetToken(db *gorm.DB, userID uint, tokenHash string, expiresAt time.Time) error {
	resetToken := models.PasswordResetToken{
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
	}
	return db.Create(&resetToken).Error
}

func FindPasswordResetTokenByHash(db *gorm.DB, tokenHash string) (*models.PasswordResetToken, error) {
	var resetToken models.PasswordResetToken
	err := db.Where("token_hash = ?", tokenHash).First(&resetToken).Error
	if err != nil {
		return nil, err
	}
	return &resetToken, nil
}

func MarkPasswordResetTokenUsed(db *gorm.DB, id uint, usedAt time.Time) (bool, error) {
	result := db.Model(&models.PasswordResetToken{}).
		Where("id = ? AND used_at IS NULL", id).
		Update("used_at", usedAt)

	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}
