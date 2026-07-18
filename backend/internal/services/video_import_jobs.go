package services

import (
	"errors"

	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrVideoImportPreviewNotFound = errors.New("link preview not found")
	ErrVideoImportForbidden       = errors.New("message forbidden")
	ErrVideoImportUnsupported     = errors.New("unsupported video provider")
)

type VideoImportJob struct {
	JobID         string
	MessageID     uint
	LinkPreviewID uint
	OriginalURL   string
	Provider      string
}

func RequestVideoImport(db *gorm.DB, userID uint, messageID uint) (models.Message, error) {
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

		if err := tx.Model(&models.MessageLinkPreview{}).
			Where("id = ?", message.LinkPreview.ID).
			Updates(map[string]any{
				"status":       models.LinkPreviewStatusImporting,
				"import_error": nil,
			}).Error; err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return models.Message{}, err
	}

	updated, err := LoadMessage(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return updated, nil
}
