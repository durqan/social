package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/models"
	"tester/internal/services"
	"tester/internal/storage"

	"gorm.io/gorm"
)

func main() {
	apply := flag.Bool("apply", false, "normalize and replace matching attachment objects")
	attachmentID := flag.Uint("id", 0, "normalize only one attachment ID")
	limit := flag.Int("limit", 0, "maximum number of attachments to process (0 means all)")
	flag.Parse()

	cfg := config.Load()
	store, err := storage.Default()
	if err != nil {
		log.Fatal("failed to configure storage: ", err)
	}
	database, err := db.NewDB(cfg)
	if err != nil {
		log.Fatal("failed to connect database: ", err)
	}
	if err := cache.InitRedis(&cfg); err != nil {
		log.Printf("Redis unavailable; realtime updates and cache invalidation are disabled: %v", err)
	}

	query := database.
		Where("file_type IN ? AND encryption_version = 0", []string{"video", "video_note"}).
		Order("id ASC")
	if *attachmentID > 0 {
		query = query.Where("id = ?", *attachmentID)
	}
	var attachments []models.MessageAttachment
	if err := query.Find(&attachments).Error; err != nil {
		log.Fatal("failed to load video attachments: ", err)
	}
	attachments = pendingAttachments(attachments, *limit)
	if !*apply {
		log.Printf("dry run: %d unencrypted video attachment(s) match; rerun with --apply", len(attachments))
		for _, attachment := range attachments {
			log.Printf(
				"candidate id=%d message_id=%d type=%s content_type=%s size=%d file=%s",
				attachment.ID,
				attachment.MessageID,
				attachment.FileType,
				attachment.ContentType,
				attachment.Size,
				attachment.FileURL,
			)
		}
		return
	}

	ctx := context.Background()
	completed := 0
	for _, attachment := range attachments {
		if err := normalizeAttachment(ctx, database, store, attachment); err != nil {
			log.Printf("attachment id=%d normalization failed: %v", attachment.ID, err)
			continue
		}
		completed++
	}
	if cache.Redis != nil {
		for _, pattern := range []string{"cache:/messages*", "cache:/conversations*"} {
			if err := cache.Redis.DeletePattern(pattern); err != nil {
				log.Printf("cache invalidation failed pattern=%s: %v", pattern, err)
			}
		}
	}
	log.Printf("video normalization complete: normalized=%d failed=%d total=%d", completed, len(attachments)-completed, len(attachments))
}

func pendingAttachments(attachments []models.MessageAttachment, limit int) []models.MessageAttachment {
	pending := make([]models.MessageAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		key := filepath.ToSlash(attachment.FileURL)
		if strings.Contains(key, "/normalized/") || strings.HasPrefix(filepath.Base(key), "normalized_") {
			continue
		}
		pending = append(pending, attachment)
		if limit > 0 && len(pending) >= limit {
			break
		}
	}
	return pending
}

func normalizeAttachment(ctx context.Context, database *gorm.DB, store storage.Storage, attachment models.MessageAttachment) error {
	oldKey, ok := services.AttachmentObjectKey(attachment.FileURL)
	if !ok {
		return fmt.Errorf("invalid stored object key %q", attachment.FileURL)
	}

	source, cleanup, err := openStoredVideo(ctx, store, oldKey)
	if err != nil {
		return err
	}
	defer cleanup()

	maxSize := int64(services.ChatVideoMaxSize)
	if attachment.FileType == "video_note" {
		maxSize = services.ChatVideoNoteMaxSize
	}
	normalized, err := services.NormalizeUploadedVideo(ctx, source, maxSize)
	if err != nil {
		return err
	}
	defer normalized.Close()

	newKey, err := storage.NewObjectKey(filepath.ToSlash(filepath.Join(filepath.Dir(oldKey), "normalized")), ".mp4")
	if err != nil {
		return err
	}
	if _, err := normalized.File.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err := store.Upload(ctx, newKey, normalized.File, services.NormalizedVideoContentType); err != nil {
		return fmt.Errorf("upload normalized object: %w", err)
	}

	originalFilename := attachment.OriginalFilename
	if strings.TrimSpace(originalFilename) == "" {
		originalFilename = fmt.Sprintf("video-%d.mp4", attachment.ID)
	} else {
		originalFilename = services.NormalizedVideoFilename(originalFilename)
	}
	updates := map[string]any{
		"file_url":          newKey,
		"content_type":      services.NormalizedVideoContentType,
		"original_filename": originalFilename,
		"width":             normalized.Width,
		"height":            normalized.Height,
		"duration_seconds":  normalized.DurationSeconds,
		"size":              normalized.Size,
	}
	result := database.Model(&models.MessageAttachment{}).
		Where("id = ? AND encryption_version = 0", attachment.ID).
		Updates(updates)
	if result.Error != nil {
		_ = store.Delete(ctx, newKey)
		return fmt.Errorf("update attachment metadata: %w", result.Error)
	}
	if result.RowsAffected != 1 {
		_ = store.Delete(ctx, newKey)
		return fmt.Errorf("attachment changed while normalizing")
	}
	if err := store.Delete(ctx, oldKey); err != nil {
		log.Printf("attachment id=%d old object cleanup failed key=%s: %v", attachment.ID, oldKey, err)
	}
	services.PublishMessageUpdate(ctx, attachment.MessageID)

	log.Printf(
		"attachment id=%d normalized mode=%s source_video=%s source_audio=%s source_pix_fmt=%s output=%s size=%d dimensions=%dx%d duration=%d",
		attachment.ID,
		normalized.Mode,
		normalized.SourceVideoCodec,
		normalized.SourceAudioCodec,
		normalized.SourcePixelFormat,
		newKey,
		normalized.Size,
		normalized.Width,
		normalized.Height,
		normalized.DurationSeconds,
	)
	return nil
}

func openStoredVideo(ctx context.Context, store storage.Storage, key string) (*os.File, func(), error) {
	if path, ok := storage.LocalPath(store, key); ok {
		file, err := os.Open(path)
		return file, func() {
			if file != nil {
				_ = file.Close()
			}
		}, err
	}

	signedURL, err := storage.SignedURL(ctx, store, key, 30*time.Minute)
	if err != nil {
		return nil, func() {}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, signedURL, nil)
	if err != nil {
		return nil, func() {}, err
	}
	response, err := http.DefaultClient.Do(request)
	if response != nil {
		defer response.Body.Close()
	}
	if err != nil {
		return nil, func() {}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, func() {}, fmt.Errorf("download stored video returned HTTP %d", response.StatusCode)
	}

	temp, err := os.CreateTemp("", "existing-video-*")
	if err != nil {
		return nil, func() {}, err
	}
	cleanup := func() {
		name := temp.Name()
		_ = temp.Close()
		_ = os.Remove(name)
	}
	if _, err := io.Copy(temp, response.Body); err != nil {
		cleanup()
		return nil, func() {}, err
	}
	if _, err := temp.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, func() {}, err
	}
	return temp, cleanup, nil
}
