package repository

import (
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

func CreateEmailVerification(db *gorm.DB, userID uint, token string) error {
	verification := models.EmailVerification{
		UserID:    userID,
		Token:     token,
		ExpiresAt: time.Now().Add(24 * time.Hour),
		Used:      false,
	}
	return db.Create(&verification).Error
}

func FindEmailVerificationByToken(db *gorm.DB, token string) (*models.EmailVerification, error) {
	var v models.EmailVerification
	err := db.Where("token = ?", token).First(&v).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func MarkEmailAsUsed(db *gorm.DB, id uint) error {
	return db.Model(&models.EmailVerification{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"used":    true,
			"used_at": time.Now(),
		}).Error
}

func VerifyUserEmail(db *gorm.DB, userID uint) error {
	result := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("is_email_verified", true)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
