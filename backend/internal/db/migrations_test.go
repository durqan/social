package db

import (
	"fmt"
	"testing"

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
