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
	assertBackendUniqueIndex(t, database, &models.MobilePushToken{}, "idx_mobile_push_tokens_token")
	assertBackendIndex(t, database, &models.Notification{}, "idx_notifications_recipient_conversation_type")
	assertBackendIndex(t, database, &models.Notification{}, "idx_notifications_recipient_created_id")
	assertBackendIndex(t, database, &models.Notification{}, "idx_notifications_recipient_actor_type_unread")
	assertBackendIndex(t, database, &models.Notification{}, "idx_notifications_recipient_type_entity_unread")
	assertBackendIndex(t, database, &models.Notification{}, "idx_notifications_recipient_conversation_type_unread")
	assertBackendUniqueIndex(t, database, &models.ConversationHead{}, "ux_conversation_heads_user_peer")
	assertBackendIndex(t, database, &models.ConversationHead{}, "idx_conversation_heads_last_message_id")
	assertBackendIndex(t, database, &models.ConversationHead{}, "idx_conversation_heads_user_order")
	assertBackendUniqueIndex(t, database, &models.PasswordResetToken{}, "idx_password_reset_tokens_token_hash")
}

func TestMigrateBackfillsConversationHeadsOnce(t *testing.T) {
	database := newBackendMigrationTestDB(t)
	if err := database.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageUserDeletion{},
		&models.ConversationPin{},
	); err != nil {
		t.Fatalf("migrate legacy conversation schema: %v", err)
	}

	users := []models.User{
		{ID: 101, Name: "Head user A", Email: "head-a@example.com", Password: "hash"},
		{ID: 102, Name: "Head user B", Email: "head-b@example.com", Password: "hash"},
	}
	if err := database.Create(&users).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	base := time.Date(2026, time.July, 14, 9, 0, 0, 0, time.UTC)
	messages := []models.Message{
		{FromID: 101, ToID: 102, Content: "first", IsRead: true, CreatedAt: base, UpdatedAt: base},
		{FromID: 102, ToID: 101, Content: "incoming", IsRead: false, CreatedAt: base.Add(time.Minute), UpdatedAt: base.Add(time.Minute)},
		{FromID: 101, ToID: 102, Content: "hidden for sender", IsRead: false, CreatedAt: base.Add(2 * time.Minute), UpdatedAt: base.Add(2 * time.Minute)},
	}
	if err := database.Create(&messages).Error; err != nil {
		t.Fatalf("seed messages: %v", err)
	}
	if err := database.Create(&models.MessageUserDeletion{
		MessageID: messages[2].ID,
		UserID:    101,
		DeletedAt: base.Add(3 * time.Minute),
	}).Error; err != nil {
		t.Fatalf("seed per-user deletion: %v", err)
	}
	if err := database.Create(&models.ConversationPin{
		UserID:         101,
		ConversationID: 102,
	}).Error; err != nil {
		t.Fatalf("seed conversation pin: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate with conversation history failed: %v", err)
	}

	userAHead := loadMigrationConversationHead(t, database, 101, 102)
	userBHead := loadMigrationConversationHead(t, database, 102, 101)
	if userAHead.ConversationID != messages[0].ID || userBHead.ConversationID != messages[0].ID {
		t.Fatalf("conversation ids = A:%d B:%d, want anchor %d", userAHead.ConversationID, userBHead.ConversationID, messages[0].ID)
	}
	if userAHead.LastMessageID == nil || *userAHead.LastMessageID != messages[1].ID {
		t.Fatalf("user A last message = %v, want %d", userAHead.LastMessageID, messages[1].ID)
	}
	if userBHead.LastMessageID == nil || *userBHead.LastMessageID != messages[2].ID {
		t.Fatalf("user B last message = %v, want %d", userBHead.LastMessageID, messages[2].ID)
	}
	if userAHead.UnreadCount != 1 || userBHead.UnreadCount != 1 {
		t.Fatalf("unread counts = A:%d B:%d, want 1/1", userAHead.UnreadCount, userBHead.UnreadCount)
	}
	if !userAHead.IsPinned || userBHead.IsPinned {
		t.Fatalf("pin states = A:%v B:%v, want true/false", userAHead.IsPinned, userBHead.IsPinned)
	}

	// Deliberately create drift through legacy direct writes. A repeated startup
	// must not perform the historical backfill again after its version marker was
	// committed.
	if err := database.Model(&models.ConversationHead{}).
		Where("user_id = ? AND peer_user_id = ?", 101, 102).
		Update("unread_count", 77).Error; err != nil {
		t.Fatalf("introduce head drift: %v", err)
	}
	legacyMessage := models.Message{
		FromID: 102, ToID: 101, Content: "legacy write after backfill", CreatedAt: base.Add(4 * time.Minute), UpdatedAt: base.Add(4 * time.Minute),
	}
	if err := database.Create(&legacyMessage).Error; err != nil {
		t.Fatalf("seed legacy post-backfill message: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("repeated Migrate failed: %v", err)
	}

	userAHead = loadMigrationConversationHead(t, database, 101, 102)
	if userAHead.UnreadCount != 77 {
		t.Fatalf("repeated migration repaired unread_count to %d, want preserved drift 77", userAHead.UnreadCount)
	}
	if userAHead.LastMessageID == nil || *userAHead.LastMessageID != messages[1].ID {
		t.Fatalf("repeated migration changed last message to %v, want %d", userAHead.LastMessageID, messages[1].ID)
	}
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

func loadMigrationConversationHead(t *testing.T, database *gorm.DB, userID, peerUserID uint) models.ConversationHead {
	t.Helper()
	var head models.ConversationHead
	if err := database.
		Where("user_id = ? AND peer_user_id = ?", userID, peerUserID).
		First(&head).Error; err != nil {
		t.Fatalf("load conversation head %d/%d: %v", userID, peerUserID, err)
	}
	return head
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
