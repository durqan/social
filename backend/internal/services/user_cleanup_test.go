package services

import (
	"context"
	"io"
	"testing"

	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type cleanupMockStorage struct {
	deleted []string
}

func (s *cleanupMockStorage) Upload(_ context.Context, _ string, _ io.Reader, _ string) error {
	return nil
}

func (s *cleanupMockStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}

func (s *cleanupMockStorage) URL(_ context.Context, key string) (string, error) {
	return "/uploads/" + key, nil
}

func TestDeleteUserAccountDeletesAvatarObject(t *testing.T) {
	store := &cleanupMockStorage{}
	defer storage.SetDefaultForTest(store)()

	db := cleanupTestDB(t)
	avatarKey := "avatars/user_1/avatar.png"
	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: avatarKey}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	if err := DeleteUserAccount(db, 1); err != nil {
		t.Fatalf("delete user account: %v", err)
	}

	if len(store.deleted) != 1 || store.deleted[0] != avatarKey {
		t.Fatalf("expected avatar %q to be deleted, got %#v", avatarKey, store.deleted)
	}
}

func cleanupTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.Comment{},
		&models.PostLike{},
		&models.CommentLike{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.Friendship{},
		&models.EmailVerification{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	return db
}
