package services

import (
	"context"
	"log"
	"time"

	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/gorm"
)

const (
	AbandonedUploadTTL             = 24 * time.Hour
	abandonedUploadCleanupInterval = time.Hour
	abandonedUploadCleanupTimeout  = 2 * time.Minute
)

var abandonedUploadPrefixes = []string{
	"messages/",
	"voice/",
	"video-notes/",
	"encrypted/",
	"chat/",
}

func StartAbandonedUploadCleanup(db *gorm.DB) {
	go func() {
		cleanupAbandonedUploads(db)

		ticker := time.NewTicker(abandonedUploadCleanupInterval)
		defer ticker.Stop()

		for range ticker.C {
			cleanupAbandonedUploads(db)
		}
	}()
}

func cleanupAbandonedUploads(db *gorm.DB) {
	ctx, cancel := context.WithTimeout(context.Background(), abandonedUploadCleanupTimeout)
	defer cancel()

	deleted, err := CleanupAbandonedUploads(ctx, db, AbandonedUploadTTL)
	if err != nil {
		log.Printf("failed to cleanup abandoned uploads: %v", err)
		return
	}
	if deleted > 0 {
		log.Printf("deleted %d abandoned uploads older than %s", deleted, AbandonedUploadTTL)
	}
}

func CleanupAbandonedUploads(ctx context.Context, db *gorm.DB, ttl time.Duration) (int, error) {
	if ttl <= 0 {
		ttl = AbandonedUploadTTL
	}

	store, err := storage.Default()
	if err != nil {
		return 0, err
	}
	lister, ok := store.(storage.ObjectLister)
	if !ok {
		return 0, nil
	}

	referenced, err := referencedAttachmentKeys(db)
	if err != nil {
		return 0, err
	}

	cutoff := time.Now().Add(-ttl)
	deleted := 0
	for _, prefix := range abandonedUploadPrefixes {
		objects, err := lister.ListPrefix(ctx, prefix)
		if err != nil {
			return deleted, err
		}
		for _, object := range objects {
			if object.Key == "" {
				continue
			}
			if _, ok := referenced[object.Key]; ok {
				continue
			}
			if object.LastModified.IsZero() || object.LastModified.After(cutoff) {
				continue
			}
			if err := store.Delete(ctx, object.Key); err != nil {
				return deleted, err
			}
			deleted++
		}
	}

	return deleted, nil
}

func referencedAttachmentKeys(db *gorm.DB) (map[string]struct{}, error) {
	var values []string
	if err := db.Model(&models.MessageAttachment{}).Pluck("file_url", &values).Error; err != nil {
		return nil, err
	}

	referenced := make(map[string]struct{}, len(values))
	for _, value := range values {
		key, ok := storage.KeyFromStoredValue(value)
		if !ok {
			continue
		}
		referenced[key] = struct{}{}
	}
	return referenced, nil
}
