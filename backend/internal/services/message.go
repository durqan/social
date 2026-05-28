package services

import (
	"errors"
	"strings"

	"tester/internal/cache"
	"tester/internal/models"
	"tester/internal/repository"

	"gorm.io/gorm"
)

var (
	ErrMessageContentRequired = errors.New("message content or image is required")
	ErrMessageForbidden       = errors.New("message forbidden")
)

func SendMessage(db *gorm.DB, fromID, toID uint, content string, attachments []models.MessageAttachment) (models.Message, error) {
	content = strings.TrimSpace(content)
	if content == "" && len(attachments) == 0 {
		return models.Message{}, ErrMessageContentRequired
	}

	message := models.Message{
		FromID:  fromID,
		ToID:    toID,
		Content: content,
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

	db.Preload("From").Preload("To").Preload("Attachments").First(&message, message.ID)
	return message, nil
}

func UpdateMessage(db *gorm.DB, userID, messageID uint, content string) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}

	if message.FromID != userID {
		return models.Message{}, ErrMessageForbidden
	}

	message.Content = content
	if err := repository.UpdateMessage(db, message); err != nil {
		return models.Message{}, err
	}

	db.Preload("From").Preload("To").Preload("Attachments").First(message, messageID)
	return *message, nil
}

func DeleteMessageForUser(db *gorm.DB, userID, messageID uint) error {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return err
	}

	if message.FromID != userID && message.ToID != userID {
		return ErrMessageForbidden
	}

	return repository.DeleteMessage(db, messageID)
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
}
