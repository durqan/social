package services

import (
	"context"
	"errors"
	"fmt"

	"tester/internal/models"
	"tester/internal/rabbit"
	"tester/internal/storage"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrVideoImportPreviewNotFound = errors.New("link preview not found")
	ErrVideoImportForbidden       = errors.New("message forbidden")
	ErrVideoImportUnsupported     = errors.New("unsupported video provider")
)

type VideoImportJob struct {
	JobID             string `json:"job_id"`
	MessageID         uint   `json:"message_id"`
	LinkPreviewID     uint   `json:"link_preview_id"`
	OriginalURL       string `json:"original_url"`
	Provider          string `json:"provider"`
	RequestedByUserID uint   `json:"requested_by_user_id"`
}

func RequestVideoImport(ctx context.Context, db *gorm.DB, userID uint, messageID uint) (models.Message, error) {
	var job *VideoImportJob
	var message models.Message

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("LinkPreview").
			Preload("Attachments").
			Where("id = ? AND (from_id = ? OR to_id = ?)", messageID, userID, userID).
			First(&message).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrVideoImportForbidden
			}
			return err
		}
		if message.LinkPreview == nil {
			return ErrVideoImportPreviewNotFound
		}
		if !IsSupportedVideoProvider(message.LinkPreview.Provider) {
			return ErrVideoImportUnsupported
		}
		if message.LinkPreview.Status == models.LinkPreviewStatusReady ||
			message.LinkPreview.Status == models.LinkPreviewStatusImporting {
			return nil
		}

		jobID, err := storage.NewUUID()
		if err != nil {
			return err
		}
		if err := tx.Model(&models.MessageLinkPreview{}).
			Where("id = ?", message.LinkPreview.ID).
			Updates(map[string]any{
				"status":       models.LinkPreviewStatusImporting,
				"import_error": nil,
			}).Error; err != nil {
			return err
		}

		job = &VideoImportJob{
			JobID:             jobID,
			MessageID:         message.ID,
			LinkPreviewID:     message.LinkPreview.ID,
			OriginalURL:       message.LinkPreview.OriginalURL,
			Provider:          message.LinkPreview.Provider,
			RequestedByUserID: userID,
		}
		return nil
	})
	if err != nil {
		return models.Message{}, err
	}

	if job != nil {
		if err := rabbit.PublishVideoImport(job); err != nil {
			_ = db.Model(&models.MessageLinkPreview{}).
				Where("id = ?", job.LinkPreviewID).
				Updates(map[string]any{
					"status":       models.LinkPreviewStatusFailed,
					"import_error": "Не удалось поставить задачу в очередь",
				}).Error
			return models.Message{}, fmt.Errorf("publish video import: %w", err)
		}
		PublishMessageUpdate(ctx, messageID)
	}

	updated, err := LoadMessage(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return updated, nil
}
