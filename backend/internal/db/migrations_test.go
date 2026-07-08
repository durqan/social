package db

import (
	"fmt"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCleanDatabaseIsRepeatable(t *testing.T) {
	database := newBackendMigrationTestDB(t)

	if err := Migrate(database); err != nil {
		t.Fatalf("first Migrate failed: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("second Migrate failed: %v", err)
	}
	assertBackendUniqueIndex(t, database, &models.EncryptedKeyBackup{}, "ux_e2ee_backup_user")
	assertBackendIndex(t, database, &models.Post{}, "idx_posts_user_created_id")
	assertBackendIndex(t, database, &models.Comment{}, "idx_comments_post_created_id")
	assertBackendIndex(t, database, &models.MessageUserDeletion{}, "idx_message_user_deletions_user_message")
	assertBackendIndex(t, database, &models.Message{}, "idx_messages_from_created_id_active")
	assertBackendIndex(t, database, &models.Message{}, "idx_messages_to_created_id_active")
	assertBackendIndex(t, database, &models.Message{}, "idx_messages_to_unread_from_active")
	assertBackendIndex(t, database, &models.MessageAttachment{}, "idx_message_attachments_message_type_encryption")
	assertBackendIndex(t, database, &models.MessageReaction{}, "idx_message_reactions_message_created_id")
	assertBackendUniqueIndex(t, database, &models.PasswordResetToken{}, "idx_password_reset_tokens_token_hash")
}

func TestMigrateRemovesOldEncryptedBackupDuplicates(t *testing.T) {
	database := newBackendMigrationTestDB(t)
	if err := database.AutoMigrate(&models.User{}); err != nil {
		t.Fatalf("migrate users: %v", err)
	}
	if err := database.Create(&models.User{
		ID:       10,
		Name:     "Migration user",
		Email:    "migration@example.com",
		Password: "hash",
	}).Error; err != nil {
		t.Fatalf("seed migration user: %v", err)
	}
	if err := database.Exec(`
		CREATE TABLE encrypted_key_backups (
			id integer primary key autoincrement,
			user_id integer not null,
			encrypted_master_key text not null,
			created_at datetime,
			updated_at datetime,
			CONSTRAINT fk_encrypted_key_backups_user
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)
	`).Error; err != nil {
		t.Fatalf("create old encrypted_key_backups: %v", err)
	}
	if err := database.Exec(`
		INSERT INTO encrypted_key_backups (user_id, encrypted_master_key)
		VALUES
			(10, '{"publicKey":"old"}'),
			(10, '{"publicKey":"new"}')
	`).Error; err != nil {
		t.Fatalf("seed E2EE duplicates: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate with duplicates failed: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("repeated Migrate failed: %v", err)
	}

	var backups []models.EncryptedKeyBackup
	if err := database.Find(&backups).Error; err != nil {
		t.Fatalf("load backups: %v", err)
	}
	if len(backups) != 1 || backups[0].EncryptedMasterKey != `{"publicKey":"new"}` {
		t.Fatalf("unexpected backups after migration: %+v", backups)
	}
	assertBackendUniqueIndex(t, database, &models.EncryptedKeyBackup{}, "ux_e2ee_backup_user")
}

func TestMigrateCleansOrphanLinkPreviewVideoAttachment(t *testing.T) {
	database := newBackendMigrationTestDB(t)
	if err := Migrate(database); err != nil {
		t.Fatalf("initial Migrate failed: %v", err)
	}

	users := []models.User{
		{ID: 20, Name: "Sender", Email: "sender@example.com", Password: "hash"},
		{ID: 21, Name: "Recipient", Email: "recipient@example.com", Password: "hash"},
	}
	if err := database.Create(&users).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	messages := []models.Message{
		{ID: 30, FromID: users[0].ID, ToID: users[1].ID, Content: "valid preview"},
		{ID: 31, FromID: users[0].ID, ToID: users[1].ID, Content: "orphan preview"},
	}
	if err := database.Create(&messages).Error; err != nil {
		t.Fatalf("seed messages: %v", err)
	}
	attachment := models.MessageAttachment{
		ID:        40,
		MessageID: messages[0].ID,
		FileURL:   "messages/video.mp4",
		FileType:  "video",
	}
	if err := database.Create(&attachment).Error; err != nil {
		t.Fatalf("seed attachment: %v", err)
	}
	validAttachmentID := attachment.ID
	validPreview := models.MessageLinkPreview{
		ID:                50,
		MessageID:         messages[0].ID,
		OriginalURL:       "https://www.instagram.com/reel/valid",
		Provider:          "instagram",
		Status:            models.LinkPreviewStatusReady,
		VideoAttachmentID: &validAttachmentID,
	}
	if err := database.Create(&validPreview).Error; err != nil {
		t.Fatalf("seed valid preview: %v", err)
	}

	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("get sql database: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := database.Exec("PRAGMA foreign_keys = OFF").Error; err != nil {
		t.Fatalf("disable foreign keys: %v", err)
	}
	orphanUpdatedAt := time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)
	if err := database.Exec(`
		INSERT INTO message_link_previews (
			id, message_id, original_url, provider, status,
			video_attachment_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`,
		51,
		messages[1].ID,
		"https://www.instagram.com/reel/orphan",
		"instagram",
		models.LinkPreviewStatusReady,
		999,
		orphanUpdatedAt,
		orphanUpdatedAt,
	).Error; err != nil {
		t.Fatalf("seed orphan preview: %v", err)
	}
	if err := database.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate with orphan preview failed: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("repeated Migrate failed: %v", err)
	}

	var gotValid models.MessageLinkPreview
	if err := database.First(&gotValid, validPreview.ID).Error; err != nil {
		t.Fatalf("load valid preview: %v", err)
	}
	if gotValid.VideoAttachmentID == nil || *gotValid.VideoAttachmentID != attachment.ID {
		t.Fatalf("valid video_attachment_id changed: %v", gotValid.VideoAttachmentID)
	}

	var gotOrphan models.MessageLinkPreview
	if err := database.First(&gotOrphan, 51).Error; err != nil {
		t.Fatalf("load orphan preview: %v", err)
	}
	if gotOrphan.VideoAttachmentID != nil {
		t.Fatalf("orphan video_attachment_id was not cleared: %v", *gotOrphan.VideoAttachmentID)
	}
	if !gotOrphan.UpdatedAt.After(orphanUpdatedAt) {
		t.Fatalf("orphan updated_at was not refreshed: %v", gotOrphan.UpdatedAt)
	}
}

func newBackendMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return database
}

func assertBackendUniqueIndex(t *testing.T, database *gorm.DB, model any, indexName string) {
	t.Helper()

	indexes, err := database.Migrator().GetIndexes(model)
	if err != nil {
		t.Fatalf("get indexes: %v", err)
	}
	for _, index := range indexes {
		if index.Name() != indexName {
			continue
		}
		unique, ok := index.Unique()
		if !ok || !unique {
			t.Fatalf("index %s is not unique", indexName)
		}
		return
	}
	t.Fatalf("missing unique index %s", indexName)
}

func assertBackendIndex(t *testing.T, database *gorm.DB, model any, indexName string) {
	t.Helper()

	indexes, err := database.Migrator().GetIndexes(model)
	if err != nil {
		t.Fatalf("get indexes: %v", err)
	}
	for _, index := range indexes {
		if index.Name() == indexName {
			return
		}
	}
	t.Fatalf("missing index %s", indexName)
}
