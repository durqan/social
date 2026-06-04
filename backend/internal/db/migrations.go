package db

import (
	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/gorm"
)

func Migrate(database *gorm.DB) error {
	if err := database.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.PostLike{},
		&models.CommentLike{},
		&models.Comment{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.Friendship{},
		&models.EmailVerification{},
	); err != nil {
		return err
	}

	return normalizeStoredUploadKeys(database)
}

func normalizeStoredUploadKeys(database *gorm.DB) error {
	if err := normalizeUserAvatarKeys(database); err != nil {
		return err
	}
	return normalizeMessageAttachmentKeys(database)
}

func normalizeUserAvatarKeys(database *gorm.DB) error {
	var users []models.User
	if err := database.Select("id", "avatar").Where("avatar <> ''").Find(&users).Error; err != nil {
		return err
	}

	for _, user := range users {
		key, ok := storage.KeyFromStoredValue(user.Avatar)
		if !ok || key == user.Avatar {
			continue
		}
		if err := database.Model(&models.User{}).
			Where("id = ?", user.ID).
			Update("avatar", key).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizeMessageAttachmentKeys(database *gorm.DB) error {
	var attachments []models.MessageAttachment
	if err := database.Select("id", "file_url").Where("file_url <> ''").Find(&attachments).Error; err != nil {
		return err
	}

	for _, attachment := range attachments {
		key, ok := storage.KeyFromStoredValue(attachment.FileURL)
		if !ok || key == attachment.FileURL {
			continue
		}
		if err := database.Model(&models.MessageAttachment{}).
			Where("id = ?", attachment.ID).
			Update("file_url", key).Error; err != nil {
			return err
		}
	}
	return nil
}
