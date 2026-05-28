package services

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/auth"
	"tester/internal/cache"
	"tester/internal/models"
	"tester/internal/repository"

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
	removeUserUploads(userID, artifacts.UploadPaths)

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
	removeUserUploads(userID, artifacts.UploadPaths)

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

func removeUserUploads(userID uint, paths []string) {
	paths = append(paths, userUploadGlob("uploads/avatars", userID)...)
	paths = append(paths, userUploadGlob("uploads/chat", userID)...)

	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		cleanPath, ok := cleanUploadPath(path)
		if !ok {
			continue
		}
		if _, exists := seen[cleanPath]; exists {
			continue
		}
		seen[cleanPath] = struct{}{}

		if err := os.Remove(cleanPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("failed to remove user upload %s: %v", cleanPath, err)
		}
	}
}

func userUploadGlob(dir string, userID uint) []string {
	matches, err := filepath.Glob(filepath.Join(dir, fmt.Sprintf("%d_*", userID)))
	if err != nil {
		return nil
	}
	return matches
}

func cleanUploadPath(path string) (string, bool) {
	path = strings.TrimPrefix(path, "/")
	path = filepath.Clean(filepath.FromSlash(path))

	if uploadPathAllowed(path, filepath.Join("uploads", "avatars")) {
		return path, true
	}
	if uploadPathAllowed(path, filepath.Join("uploads", "chat")) {
		return path, true
	}
	return "", false
}

func uploadPathAllowed(path string, root string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != "." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}
