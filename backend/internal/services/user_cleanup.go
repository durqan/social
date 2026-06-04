package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/auth"
	"tester/internal/cache"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/storage"

	"gorm.io/gorm"
)

const unverifiedUserCleanupInterval = time.Minute

func StartUnverifiedUserCleanup(db *gorm.DB) {
	go func() {
		cleanupExpiredUnverifiedUsers(db)

		ticker := time.NewTicker(unverifiedUserCleanupInterval)
		defer ticker.Stop()

		for range ticker.C {
			cleanupExpiredUnverifiedUsers(db)
		}
	}()
}

func DeleteUserAccount(db *gorm.DB, userID uint) error {
	artifacts, err := repository.DeleteUser(db, userID)
	if err != nil {
		return err
	}

	revokeUserSessions(userID)
	invalidateUserDeletionCaches()
	removeUserUploads(db, userID, artifacts.UploadPaths)

	return nil
}

func cleanupExpiredUnverifiedUsers(db *gorm.DB) {
	deleted, err := DeleteExpiredUnverifiedUsers(db, time.Now())
	if err != nil {
		log.Printf("failed to cleanup unverified users: %v", err)
		return
	}
	if deleted > 0 {
		log.Printf("deleted %d unverified users older than %s", deleted, models.EmailVerificationTTL)
	}
}

func DeleteExpiredUnverifiedUsers(db *gorm.DB, now time.Time) (int, error) {
	cutoff := now.Add(-models.EmailVerificationTTL)
	userIDs, err := repository.GetExpiredUnverifiedUserIDs(db, cutoff)
	if err != nil {
		return 0, err
	}

	deleted := 0
	for _, userID := range userIDs {
		ok, err := deleteExpiredUnverifiedUserAccount(db, userID, cutoff)
		if err != nil {
			return deleted, err
		}
		if ok {
			deleted++
		}
	}

	return deleted, nil
}

func deleteExpiredUnverifiedUserAccount(db *gorm.DB, userID uint, cutoff time.Time) (bool, error) {
	artifacts, deleted, err := repository.DeleteExpiredUnverifiedUser(db, userID, cutoff)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	if !deleted {
		return false, nil
	}

	revokeUserSessions(userID)
	invalidateUserDeletionCaches()
	removeUserUploads(db, userID, artifacts.UploadPaths)

	return true, nil
}

func revokeUserSessions(userID uint) {
	if cache.Redis == nil {
		return
	}
	if err := auth.RevokeUserSessions(userID); err != nil {
		log.Printf("failed to revoke sessions for user %d: %v", userID, err)
	}
}

func invalidateUserDeletionCaches() {
	if cache.Redis == nil {
		return
	}

	patterns := []string{
		"cache:/users*",
		"cache:/friends*",
		"cache:/posts*",
		"cache:/messages*",
	}
	for _, pattern := range patterns {
		_ = cache.Redis.DeletePattern(pattern)
	}
}

func removeUserUploads(db *gorm.DB, userID uint, paths []string) {
	paths = append(paths, userUploadGlob("uploads/avatars", userID)...)
	paths = append(paths, userUploadGlob("uploads/chat", userID)...)

	store, err := storage.Default()
	if err != nil {
		log.Printf("failed to load storage for user upload cleanup: %v", err)
		return
	}

	ctx := context.Background()
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		key, ok := storage.KeyFromStoredValue(path)
		if !ok {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		referenced, err := userUploadStillReferenced(db, key)
		if err != nil {
			log.Printf("failed to check upload references for %s: %v", key, err)
			continue
		}
		if referenced {
			continue
		}

		if err := store.Delete(ctx, key); err != nil {
			log.Printf("failed to remove user upload %s: %v", key, err)
		}
	}
}

func userUploadStillReferenced(db *gorm.DB, key string) (bool, error) {
	if !strings.HasPrefix(key, "chat/") && !strings.HasPrefix(key, "messages/") {
		return false, nil
	}

	variants := []string{key}
	if strings.HasPrefix(key, "chat/") {
		filename := filepath.Base(key)
		variants = append(variants, "/uploads/chat/"+filename, "uploads/chat/"+filename)
	}

	var count int64
	err := db.Table("message_attachments").
		Joins("JOIN messages ON messages.id = message_attachments.message_id").
		Where("message_attachments.file_url IN ? AND messages.deleted_at IS NULL", variants).
		Count(&count).Error
	return count > 0, err
}

func userUploadGlob(dir string, userID uint) []string {
	matches, err := filepath.Glob(filepath.Join(dir, fmt.Sprintf("%d_*", userID)))
	if err != nil {
		return nil
	}
	return matches
}
