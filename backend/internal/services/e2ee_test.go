package services

import (
	"fmt"
	"testing"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSaveEncryptedKeyBackupUpsertsPerUser(t *testing.T) {
	db := newE2EEServiceTestDB(t)

	if err := SaveEncryptedKeyBackup(db, 1, `{"publicKey":"first"}`); err != nil {
		t.Fatalf("first SaveEncryptedKeyBackup failed: %v", err)
	}
	if err := SaveEncryptedKeyBackup(db, 1, `{"publicKey":"second"}`); err != nil {
		t.Fatalf("second SaveEncryptedKeyBackup failed: %v", err)
	}

	var backups []models.EncryptedKeyBackup
	if err := db.Find(&backups).Error; err != nil {
		t.Fatalf("load backups: %v", err)
	}
	if len(backups) != 1 {
		t.Fatalf("backup count = %d, want 1", len(backups))
	}
	if backups[0].UserID != 1 || backups[0].EncryptedMasterKey != `{"publicKey":"second"}` {
		t.Fatalf("backup was not updated safely: %+v", backups[0])
	}
}

func TestSaveEncryptedKeyBackupDoesNotOverwriteAnotherUser(t *testing.T) {
	db := newE2EEServiceTestDB(t)

	if err := SaveEncryptedKeyBackup(db, 1, `{"publicKey":"user-1"}`); err != nil {
		t.Fatal(err)
	}
	if err := SaveEncryptedKeyBackup(db, 2, `{"publicKey":"user-2"}`); err != nil {
		t.Fatal(err)
	}
	if err := SaveEncryptedKeyBackup(db, 1, `{"publicKey":"user-1-updated"}`); err != nil {
		t.Fatal(err)
	}

	var backups []models.EncryptedKeyBackup
	if err := db.Order("user_id").Find(&backups).Error; err != nil {
		t.Fatalf("load backups: %v", err)
	}
	if len(backups) != 2 {
		t.Fatalf("backup count = %d, want 2", len(backups))
	}
	if backups[0].EncryptedMasterKey != `{"publicKey":"user-1-updated"}` ||
		backups[1].EncryptedMasterKey != `{"publicKey":"user-2"}` {
		t.Fatalf("unexpected backups: %+v", backups)
	}
}

func TestE2EEPublicStatusForUserReturnsPublicKey(t *testing.T) {
	db := newE2EEServiceTestDB(t)
	if err := SaveEncryptedKeyBackup(db, 1, `{"publicKey":"user-1-public"}`); err != nil {
		t.Fatal(err)
	}

	status, err := E2EEPublicStatusForUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Enabled || status.PublicKey != "user-1-public" {
		t.Fatalf("status = %+v, want enabled public key", status)
	}
}

func TestE2EEPublicStatusForUserReturnsDisabledWithoutBackup(t *testing.T) {
	db := newE2EEServiceTestDB(t)

	status, err := E2EEPublicStatusForUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if status.Enabled || status.PublicKey != "" {
		t.Fatalf("status = %+v, want disabled", status)
	}
}

func newE2EEServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.EncryptedKeyBackup{}); err != nil {
		t.Fatalf("migrate e2ee: %v", err)
	}
	if err := db.Create(&[]models.User{
		{ID: 1, Name: "User 1", Email: "user1@example.com", Password: "hash"},
		{ID: 2, Name: "User 2", Email: "user2@example.com", Password: "hash"},
	}).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	return db
}
