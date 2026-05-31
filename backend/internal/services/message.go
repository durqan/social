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
	ErrMessageContentTooLong  = errors.New("message content is too long")
	ErrMessageForbidden       = errors.New("message forbidden")
	ErrMessageNotFriends      = errors.New("message requires accepted friendship")
	ErrMessageInvalidReply    = errors.New("reply message is outside this conversation")
)

const MaxMessageContentLength = 1000

func SendMessage(db *gorm.DB, fromID, toID uint, content string, attachments []models.MessageAttachment, replyToMessageID *uint) (models.Message, error) {
	content = strings.TrimSpace(content)
	if content == "" && len(attachments) == 0 {
		return models.Message{}, ErrMessageContentRequired
	}
	if len([]rune(content)) > MaxMessageContentLength {
		return models.Message{}, ErrMessageContentTooLong
	}

	status, err := repository.GetFriendshipStatus(db, fromID, toID)
	if err != nil {
		return models.Message{}, err
	}
	if status != "accepted" {
		return models.Message{}, ErrMessageNotFriends
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
		FromID:           fromID,
		ToID:             toID,
		Content:          content,
		ReplyToMessageID: replyToMessageID,
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
					MessageID: message.ID,
					FileURL:   attachment.FileURL,
					FileType:  attachment.FileType,
					Width:     attachment.Width,
					Height:    attachment.Height,
					Size:      attachment.Size,
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

	return messages, nil
}

func LoadMessage(db *gorm.DB, messageID uint) (models.Message, error) {
	message, err := repository.GetMessageByID(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return *message, nil
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

	updated, err := LoadMessage(db, messageID)
	if err != nil {
		return models.Message{}, err
	}
	return updated, nil
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
