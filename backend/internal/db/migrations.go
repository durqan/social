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

	if err := ensurePerformanceIndexes(database); err != nil {
		return err
	}

	return normalizeStoredUploadKeys(database)
}

func ensurePerformanceIndexes(database *gorm.DB) error {
	indexes := []string{
		"idx_posts_user_created_id ON posts (user_id, created_at DESC, id DESC)",
		"idx_comments_post_created_id ON comments (post_id, created_at ASC, id ASC)",
		"idx_message_user_deletions_user_message ON message_user_deletions (user_id, message_id)",
		"idx_messages_from_created_id_active ON messages (from_id, created_at DESC, id DESC) WHERE deleted_at IS NULL",
		"idx_messages_to_created_id_active ON messages (to_id, created_at DESC, id DESC) WHERE deleted_at IS NULL",
		"idx_messages_to_unread_from_active ON messages (to_id, is_read, from_id) WHERE deleted_at IS NULL",
		"idx_message_attachments_message_type_encryption ON message_attachments (message_id, file_type, encryption_version)",
		"idx_message_reactions_message_created_id ON message_reactions (message_id, created_at ASC, id ASC)",
	}
	for _, index := range indexes {
		if err := createIndexIfMissing(database, index); err != nil {
			return err
		}
	}
	return nil
}

func createIndexIfMissing(database *gorm.DB, definition string) error {
	concurrently := ""
	if database.Dialector.Name() == "postgres" {
		concurrently = "CONCURRENTLY "
	}
	return database.Exec("CREATE INDEX " + concurrently + "IF NOT EXISTS " + definition).Error
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
