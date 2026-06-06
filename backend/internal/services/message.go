package services

import (
	"context"
	"errors"
	"log"
	"path/filepath"
	"strings"

	"tester/internal/cache"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/storage"

	"gorm.io/gorm"
)

var (
	ErrMessageContentRequired             = errors.New("message content or attachment is required")
	ErrMessageContentTooLong              = errors.New("message content is too long")
	ErrMessageForbidden                   = errors.New("message forbidden")
	ErrMessageNotFriends                  = errors.New("message requires accepted friendship")
	ErrMessageInvalidReply                = errors.New("reply message is outside this conversation")
	ErrMessageInvalidPin                  = errors.New("pin message is outside this conversation or deleted")
	ErrMessageInvalidEncryption           = errors.New("message encryption payload is invalid")
	ErrMessageEncryptedForwardUnsupported = errors.New("encrypted messages must be forwarded by the client")
)

const MaxMessageContentLength = 1000
const MaxEncryptedMessagePayloadLength = 128 * 1024

type MessageEncryptionInput struct {
	Version    int
	Ciphertext string
	Nonce      string
}

type EncryptedForwardInput struct {
	ToUserID    uint
	Encryption  MessageEncryptionInput
	Attachments []models.MessageAttachment
}

func (input MessageEncryptionInput) Enabled() bool {
	return input.Version > 0 || strings.TrimSpace(input.Ciphertext) != "" || strings.TrimSpace(input.Nonce) != ""
}

func SendMessage(db *gorm.DB, fromID, toID uint, content string, attachments []models.MessageAttachment, replyToMessageID *uint, encryption MessageEncryptionInput) (models.Message, error) {
	normalizedContent, normalizedEncryption, err := normalizeMessageContent(content, len(attachments), encryption)
	if err != nil {
		return models.Message{}, err
	}

	status, err := repository.GetFriendshipStatus(db, fromID, toID)
	if err != nil {
		return models.Message{}, err
	}
	if status != "accepted" {
		return models.Message{}, ErrMessageNotFriends
	}
	e2eeStatus, err := E2EEPublicStatusForUser(db, fromID)
	if err != nil {
		return models.Message{}, err
	}
	if e2eeStatus.Enabled && !normalizedEncryption.Enabled() && normalizedContent != "" {
		return models.Message{}, ErrMessageInvalidEncryption
	}
	if e2eeStatus.Enabled && attachmentsHavePlaintext(attachments) {
		return models.Message{}, ErrMessageInvalidEncryption
	}

	if replyToMessageID != nil {
		if _, err := repository.GetMessageInConversation(db, *replyToMessageID, fromID, toID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return models.Message{}, ErrMessageInvalidReply
			}
			return models.Message{}, err
		}
	}

	message := models.Message{
		FromID:            fromID,
		ToID:              toID,
		Content:           normalizedContent,
		EncryptionVersion: normalizedEncryption.Version,
		Ciphertext:        normalizedEncryption.Ciphertext,
		Nonce:             normalizedEncryption.Nonce,
		ReplyToMessageID:  replyToMessageID,
	}

	if err := repository.CreateMessage(db, &message); err != nil {
		return models.Message{}, err
	}

	for i := range attachments {
		attachments[i].MessageID = message.ID
	}

	if err := repository.CreateMessageAttachments(db, attachments); err != nil {
		return models.Message{}, err
	}

	message, err = LoadMessage(db, message.ID)
	if err != nil {
		return models.Message{}, err
	}
	InvalidateMessageCaches()
	return message, nil
}

func ForwardMessage(db *gorm.DB, userID uint, sourceMessageID uint, toIDs []uint) ([]models.Message, error) {
	if len(toIDs) == 0 {
		return nil, ErrMessageContentRequired
	}

	source, err := repository.GetMessageByIDForUser(db, sourceMessageID, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageForbidden
		}
		return nil, err
	}
	if source.EncryptionVersion > 0 || messageHasEncryptedAttachments(source) {
		return nil, ErrMessageEncryptedForwardUnsupported
	}

	messages := make([]models.Message, 0, len(toIDs))
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, toID := range toIDs {
			if toID == 0 || toID == userID {
				return ErrMessageForbidden
			}

			status, err := repository.GetFriendshipStatus(tx, userID, toID)
			if err != nil {
				return err
			}
			if status != "accepted" {
				return ErrMessageNotFriends
			}

			var replyToMessageID *uint
			if source.ReplyToMessageID != nil {
				if _, err := repository.GetMessageInConversation(tx, *source.ReplyToMessageID, userID, toID); err == nil {
					id := *source.ReplyToMessageID
					replyToMessageID = &id
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
			}

			sourceID := source.ID
			sourceUserID := source.FromID
			message := models.Message{
				FromID:                 userID,
				ToID:                   toID,
				Content:                source.Content,
				ReplyToMessageID:       replyToMessageID,
				ForwardedFromMessageID: &sourceID,
				ForwardedFromUserID:    &sourceUserID,
			}

			if err := repository.CreateMessage(tx, &message); err != nil {
				return err
			}

			attachments := make([]models.MessageAttachment, 0, len(source.Attachments))
			for _, attachment := range source.Attachments {
				attachments = append(attachments, models.MessageAttachment{
					MessageID:         message.ID,
					FileURL:           attachment.FileURL,
					FileType:          attachment.FileType,
					Width:             attachment.Width,
					Height:            attachment.Height,
					DurationSeconds:   attachment.DurationSeconds,
					Size:              attachment.Size,
					EncryptionVersion: attachment.EncryptionVersion,
					EncryptedFileKey:  attachment.EncryptedFileKey,
					FileNonce:         attachment.FileNonce,
					EncryptedMetadata: attachment.EncryptedMetadata,
				})
			}
			if err := repository.CreateMessageAttachments(tx, attachments); err != nil {
				return err
			}

			fullMessage, err := LoadMessage(tx, message.ID)
			if err != nil {
				return err
			}
			messages = append(messages, fullMessage)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return messages, nil
}

func ForwardEncryptedMessage(db *gorm.DB, userID uint, sourceMessageID uint, inputs []EncryptedForwardInput) ([]models.Message, error) {
	if len(inputs) == 0 {
		return nil, ErrMessageContentRequired
	}

	source, err := repository.GetMessageByIDForUser(db, sourceMessageID, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMessageForbidden
		}
		return nil, err
	}
	sourceHasEncryptedContent := source.EncryptionVersion > 0
	sourceHasEncryptedAttachments := messageHasEncryptedAttachments(source)
	if !sourceHasEncryptedContent && !sourceHasEncryptedAttachments {
		return nil, ErrMessageInvalidEncryption
	}

	messages := make([]models.Message, 0, len(inputs))
	err = db.Transaction(func(tx *gorm.DB) error {
		for _, input := range inputs {
			toID := input.ToUserID
			if toID == 0 || toID == userID {
				return ErrMessageForbidden
			}
			if sourceHasEncryptedContent && !input.Encryption.Enabled() {
				return ErrMessageInvalidEncryption
			}
			if sourceHasEncryptedAttachments && len(input.Attachments) != len(source.Attachments) {
				return ErrMessageInvalidEncryption
			}

			_, normalizedEncryption, err := normalizeMessageContent("", len(input.Attachments), input.Encryption)
			if err != nil {
				return err
			}

			status, err := repository.GetFriendshipStatus(tx, userID, toID)
			if err != nil {
				return err
			}
			if status != "accepted" {
				return ErrMessageNotFriends
			}

			sourceID := source.ID
			sourceUserID := source.FromID
			message := models.Message{
				FromID:                 userID,
				ToID:                   toID,
				Content:                "",
				EncryptionVersion:      normalizedEncryption.Version,
				Ciphertext:             normalizedEncryption.Ciphertext,
				Nonce:                  normalizedEncryption.Nonce,
				ForwardedFromMessageID: &sourceID,
				ForwardedFromUserID:    &sourceUserID,
			}

			if err := repository.CreateMessage(tx, &message); err != nil {
				return err
			}

			attachments := make([]models.MessageAttachment, 0, len(input.Attachments))
			for _, attachment := range input.Attachments {
				attachments = append(attachments, models.MessageAttachment{
					MessageID:         message.ID,
					FileURL:           attachment.FileURL,
					FileType:          attachment.FileType,
					Width:             attachment.Width,
					Height:            attachment.Height,
					DurationSeconds:   attachment.DurationSeconds,
					Size:              attachment.Size,
					EncryptionVersion: attachment.EncryptionVersion,
					EncryptedFileKey:  attachment.EncryptedFileKey,
					FileNonce:         attachment.FileNonce,
					EncryptedMetadata: attachment.EncryptedMetadata,
				})
			}
			if err := repository.CreateMessageAttachments(tx, attachments); err != nil {
				return err
			}

			fullMessage, err := LoadMessage(tx, message.ID)
			if err != nil {
				return err
			}
			messages = append(messages, fullMessage)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return messages, nil
}

func LoadMessage(db *gorm.DB, messageID uint) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return *message, nil
}

func GetPinnedMessage(db *gorm.DB, userID, conversationUserID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	pin, err := repository.GetPinnedMessage(db, conversationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return pin, nil
}

func PinMessage(db *gorm.DB, userID, conversationUserID, messageID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	message, err := repository.GetMessageInConversation(db, messageID, userID, conversationUserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrMessageInvalidPin
	}
	if err != nil {
		return nil, err
	}

	pin, err := repository.ReplacePinnedMessage(db, conversationID, message.ID, userID)
	if err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return pin, nil
}

func UnpinMessage(db *gorm.DB, userID, conversationUserID uint) (*models.PinnedMessage, error) {
	conversationID, err := canonicalConversationForUser(db, userID, conversationUserID)
	if err != nil {
		return nil, err
	}

	pin, err := repository.GetPinnedMessage(db, conversationID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := repository.DeletePinnedMessage(db, conversationID); err != nil {
			return nil, err
		}
		InvalidateMessageCaches()
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if err := repository.DeletePinnedMessage(db, conversationID); err != nil {
		return nil, err
	}

	InvalidateMessageCaches()
	return pin, nil
}

func canonicalConversationForUser(db *gorm.DB, userID, conversationUserID uint) (uint, error) {
	participant, err := repository.ConversationExistsForUser(db, userID, conversationUserID)
	if err != nil {
		return 0, err
	}
	if !participant {
		return 0, ErrMessageForbidden
	}

	conversationID, err := repository.CanonicalConversationID(db, userID, conversationUserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, ErrMessageForbidden
	}
	if err != nil {
		return 0, err
	}
	return conversationID, nil
}

func UpdateMessage(db *gorm.DB, userID, messageID uint, content string, encryption MessageEncryptionInput) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}

	if message.FromID != userID {
		return models.Message{}, ErrMessageForbidden
	}

	normalizedContent, normalizedEncryption, err := normalizeMessageContent(content, 0, encryption)
	if err != nil {
		return models.Message{}, err
	}
	if message.EncryptionVersion > 0 && !normalizedEncryption.Enabled() {
		return models.Message{}, ErrMessageInvalidEncryption
	}
	if !normalizedEncryption.Enabled() && normalizedContent != "" {
		e2eeStatus, err := E2EEPublicStatusForUser(db, userID)
		if err != nil {
			return models.Message{}, err
		}
		if e2eeStatus.Enabled {
			return models.Message{}, ErrMessageInvalidEncryption
		}
	}

	message.Content = normalizedContent
	message.EncryptionVersion = normalizedEncryption.Version
	message.Ciphertext = normalizedEncryption.Ciphertext
	message.Nonce = normalizedEncryption.Nonce
	if err := repository.UpdateMessage(db, message); err != nil {
		return models.Message{}, err
	}

	updated, err := LoadMessage(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	InvalidateMessageCaches()
	return updated, nil
}

func normalizeMessageContent(content string, attachmentCount int, encryption MessageEncryptionInput) (string, MessageEncryptionInput, error) {
	if encryption.Enabled() {
		encryption.Ciphertext = strings.TrimSpace(encryption.Ciphertext)
		encryption.Nonce = strings.TrimSpace(encryption.Nonce)
		if encryption.Version != 1 || encryption.Ciphertext == "" || encryption.Nonce == "" {
			return "", MessageEncryptionInput{}, ErrMessageInvalidEncryption
		}
		if len(encryption.Ciphertext) > MaxEncryptedMessagePayloadLength || len(encryption.Nonce) > 256 {
			return "", MessageEncryptionInput{}, ErrMessageInvalidEncryption
		}
		return "", encryption, nil
	}

	content = strings.TrimSpace(content)
	if content == "" && attachmentCount == 0 {
		return "", MessageEncryptionInput{}, ErrMessageContentRequired
	}
	if len([]rune(content)) > MaxMessageContentLength {
		return "", MessageEncryptionInput{}, ErrMessageContentTooLong
	}
	return content, MessageEncryptionInput{}, nil
}

func DeleteMessageForUser(db *gorm.DB, userID, messageID uint) error {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return err
	}

	if message.FromID != userID && message.ToID != userID {
		return ErrMessageForbidden
	}

	keys := attachmentKeys(message.Attachments)
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := repository.DeleteMessage(tx, messageID); err != nil {
			return err
		}
		if err := repository.DeletePinnedMessagesByMessageIDs(tx, []uint{messageID}); err != nil {
			return err
		}
		return deleteMessageAttachmentRows(tx, []uint{messageID})
	})
	if err != nil {
		return err
	}

	deleteUnreferencedStorageObjects(context.Background(), db, keys)
	InvalidateMessageCaches()
	return nil
}

func DeleteMessagesBatchForUser(db *gorm.DB, ids []uint, userID uint) ([]models.Message, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	var count int64
	if err := db.Model(&models.Message{}).
		Where("id IN ? AND (from_id = ? OR to_id = ?)", ids, userID, userID).
		Count(&count).Error; err != nil {
		return nil, err
	}
	if int(count) != len(ids) {
		return nil, ErrMessageForbidden
	}

	var messages []models.Message
	if err := db.Preload("Attachments").
		Where("id IN ? AND (from_id = ? OR to_id = ?)", ids, userID, userID).
		Find(&messages).Error; err != nil {
		return nil, err
	}

	keys := make([]string, 0)
	for _, message := range messages {
		keys = append(keys, attachmentKeys(message.Attachments)...)
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&models.Message{}, ids).Error; err != nil {
			return err
		}
		if err := repository.DeletePinnedMessagesByMessageIDs(tx, ids); err != nil {
			return err
		}
		return deleteMessageAttachmentRows(tx, ids)
	})
	if err != nil {
		return nil, err
	}

	deleteUnreferencedStorageObjects(context.Background(), db, keys)
	InvalidateMessageCaches()
	return messages, nil
}

func MarkConversationRead(db *gorm.DB, fromID, toID uint) error {
	if err := repository.MarkMessagesAsRead(db, fromID, toID); err != nil {
		return err
	}
	InvalidateMessageCaches()
	return nil
}

func InvalidateMessageCaches() {
	if cache.Redis == nil {
		return
	}

	_ = cache.Redis.DeletePattern("cache:/messages*")
	_ = cache.Redis.DeletePattern("cache:/conversations*")
}

func deleteMessageAttachmentRows(db *gorm.DB, messageIDs []uint) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return db.Where("message_id IN ?", messageIDs).Delete(&models.MessageAttachment{}).Error
}

func attachmentKeys(attachments []models.MessageAttachment) []string {
	keys := make([]string, 0, len(attachments))
	for _, attachment := range attachments {
		key, ok := storage.KeyFromStoredValue(attachment.FileURL)
		if ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func messageHasEncryptedAttachments(message *models.Message) bool {
	if message == nil {
		return false
	}
	for _, attachment := range message.Attachments {
		if attachment.EncryptionVersion > 0 {
			return true
		}
	}
	return false
}

func attachmentsHavePlaintext(attachments []models.MessageAttachment) bool {
	for _, attachment := range attachments {
		if attachment.EncryptionVersion == 0 {
			return true
		}
	}
	return false
}

func deleteUnreferencedStorageObjects(ctx context.Context, db *gorm.DB, keys []string) {
	if len(keys) == 0 {
		return
	}

	store, err := storage.Default()
	if err != nil {
		log.Printf("failed to load storage for attachment cleanup: %v", err)
		return
	}

	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		referenced, err := attachmentObjectStillReferenced(ctx, db, store, key)
		if err != nil {
			log.Printf("failed to check attachment references for %s: %v", key, err)
			continue
		}
		if referenced {
			continue
		}

		if err := store.Delete(ctx, key); err != nil {
			log.Printf("failed to delete message attachment %s: %v", key, err)
		}
	}
}

func attachmentObjectStillReferenced(ctx context.Context, db *gorm.DB, store storage.Storage, key string) (bool, error) {
	variants := storedValueVariants(ctx, store, key)
	var count int64
	err := db.Table("message_attachments").
		Joins("JOIN messages ON messages.id = message_attachments.message_id").
		Where("message_attachments.file_url IN ? AND messages.deleted_at IS NULL", variants).
		Count(&count).Error
	return count > 0, err
}

func storedValueVariants(ctx context.Context, store storage.Storage, key string) []string {
	variants := []string{key}
	if strings.HasPrefix(key, "chat/") {
		filename := filepath.Base(key)
		variants = append(variants, "/uploads/chat/"+filename, "uploads/chat/"+filename)
	}
	if objectURL, err := store.URL(ctx, key); err == nil && objectURL != "" {
		variants = append(variants, objectURL)
	}
	return variants
}
