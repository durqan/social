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
		&models.MessageReaction{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
		&models.MessageLinkPreview{},
		&models.ConversationPin{},
		&models.PinnedMessage{},
		&models.CallLog{},
		&models.Friendship{},
		&models.EmailVerification{},
		&models.NotificationOutbox{},
	); err != nil {
		return err
	}

	if err := migrateEncryptedKeyBackups(database); err != nil {
		return err
	}

	return normalizeStoredUploadKeys(database)
}

func migrateEncryptedKeyBackups(database *gorm.DB) error {
	if !database.Migrator().HasTable(&models.EncryptedKeyBackup{}) {
		return database.AutoMigrate(&models.EncryptedKeyBackup{})
	}

	var backups []models.EncryptedKeyBackup
	if err := database.Select("id", "user_id").Order("user_id, id desc").Find(&backups).Error; err != nil {
		return err
	}

	seenUsers := make(map[uint]struct{}, len(backups))
	duplicateIDs := make([]uint, 0)
	for _, backup := range backups {
		if _, exists := seenUsers[backup.UserID]; exists {
			duplicateIDs = append(duplicateIDs, backup.ID)
			continue
		}
		seenUsers[backup.UserID] = struct{}{}
	}
	if len(duplicateIDs) > 0 {
		if err := database.Where("id IN ?", duplicateIDs).Delete(&models.EncryptedKeyBackup{}).Error; err != nil {
			return err
		}
	}

	if database.Migrator().HasIndex(&models.EncryptedKeyBackup{}, "ux_e2ee_backup_user") {
		return nil
	}
	return database.Migrator().CreateIndex(&models.EncryptedKeyBackup{}, "ux_e2ee_backup_user")
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
