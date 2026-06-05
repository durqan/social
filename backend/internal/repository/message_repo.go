package repository

import (
	"errors"
	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func CreateMessage(db *gorm.DB, message *models.Message) error {
	return db.Create(message).Error
}

func CreateMessageAttachments(db *gorm.DB, attachments []models.MessageAttachment) error {
	if len(attachments) == 0 {
		return nil
	}

	return db.Create(&attachments).Error
}

func preloadMessageRelations(db *gorm.DB) *gorm.DB {
	return db.
		Preload("From").
		Preload("To").
		Preload("Attachments").
		Preload("ReplyToMessage.From").
		Preload("ReplyToMessage.Attachments").
		Preload("ForwardedFromUser").
		Preload("ForwardedFromMessage.From").
		Preload("ForwardedFromMessage.Attachments")
}

func GetMessageAttachmentForUser(db *gorm.DB, attachmentID, userID uint) (*models.MessageAttachment, error) {
	var attachment models.MessageAttachment
	err := db.
		Joins("JOIN messages ON messages.id = message_attachments.message_id").
		Where("message_attachments.id = ? AND (messages.from_id = ? OR messages.to_id = ?)", attachmentID, userID, userID).
		First(&attachment).Error
	return &attachment, err
}

func GetConversations(db *gorm.DB, userID uint) ([]map[string]interface{}, error) {
	var conversations []map[string]interface{}

	err := db.Raw(`
        SELECT 
            user_id,
            name,
            avatar,
            avatar_position_x,
            avatar_position_y,
            avatar_scale,
            last_message,
            last_message_at,
            last_sender_id,
            last_sender_name,
            last_is_mine,
            last_read,
            unread_count,
            is_pinned
        FROM (
            SELECT 
                CASE 
                    WHEN m.from_id = ? THEN m.to_id
                    ELSE m.from_id
                END as user_id,
                u.name,
                u.avatar,
                u.avatar_position_x,
                u.avatar_position_y,
                u.avatar_scale,
                COALESCE(
                    NULLIF(m.content, ''),
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM message_attachments ma
                            WHERE ma.message_id = m.id AND ma.file_type = 'video_note'
                        ) THEN 'Видео-сообщение'
                        WHEN EXISTS (
                            SELECT 1 FROM message_attachments ma
                            WHERE ma.message_id = m.id AND ma.file_type = 'voice'
                        ) THEN 'Голосовое сообщение'
                        WHEN EXISTS (
                            SELECT 1 FROM message_attachments ma
                            WHERE ma.message_id = m.id AND ma.file_type = 'image'
                        ) THEN 'Изображение'
                        ELSE ''
                    END
                ) as last_message,
                m.created_at as last_message_at,
                m.from_id as last_sender_id,
                sender.name as last_sender_name,
                (m.from_id = ?) as last_is_mine,
                m.is_read as last_read,
                (
                    SELECT COUNT(*) FROM messages 
                    WHERE to_id = ? AND from_id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END 
                    AND is_read = false
                    AND deleted_at IS NULL
                ) as unread_count,
                (cp.id IS NOT NULL) as is_pinned,
                ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END 
                    ORDER BY m.created_at DESC
                ) as rn
            FROM messages m
            JOIN users u ON u.id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END
            JOIN users sender ON sender.id = m.from_id
            LEFT JOIN conversation_pins cp
                ON cp.user_id = ?
                AND cp.conversation_id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END
            WHERE (m.from_id = ? OR m.to_id = ?)
            AND m.deleted_at IS NULL
        ) subq
        WHERE rn = 1
        ORDER BY is_pinned DESC, last_message_at DESC
    `, userID, userID, userID, userID, userID, userID, userID, userID, userID, userID).
		Scan(&conversations).Error

	return conversations, err
}

func ConversationExistsForUser(db *gorm.DB, userID, conversationID uint) (bool, error) {
	if userID == 0 || conversationID == 0 || userID == conversationID {
		return false, nil
	}

	var count int64
	err := db.Model(&models.Message{}).
		Where(
			"((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND deleted_at IS NULL",
			userID,
			conversationID,
			conversationID,
			userID,
		).
		Count(&count).Error

	return count > 0, err
}

func PinConversation(db *gorm.DB, userID, conversationID uint) error {
	pin := models.ConversationPin{
		UserID:         userID,
		ConversationID: conversationID,
	}

	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "conversation_id"}},
		DoNothing: true,
	}).Create(&pin).Error
}

func UnpinConversation(db *gorm.DB, userID, conversationID uint) error {
	return db.
		Where("user_id = ? AND conversation_id = ?", userID, conversationID).
		Delete(&models.ConversationPin{}).Error
}

func MarkMessagesAsRead(db *gorm.DB, fromID, toID uint) error {
	return db.Model(&models.Message{}).
		Where("from_id = ? AND to_id = ? AND is_read = false", fromID, toID).
		Update("is_read", true).Error
}

func GetMessageByID(db *gorm.DB, id uint) (*models.Message, error) {
	var message models.Message
	err := preloadMessageRelations(db).First(&message, id).Error
	return &message, err
}

func GetMessageByIDForUser(db *gorm.DB, id, userID uint) (*models.Message, error) {
	var message models.Message
	err := preloadMessageRelations(db).
		Where("id = ? AND (from_id = ? OR to_id = ?)", id, userID, userID).
		First(&message).Error
	return &message, err
}

func GetMessageInConversation(db *gorm.DB, id, userID1, userID2 uint) (*models.Message, error) {
	var message models.Message
	err := preloadMessageRelations(db).
		Where(
			"id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))",
			id,
			userID1,
			userID2,
			userID2,
			userID1,
		).
		First(&message).Error
	return &message, err
}

func UpdateMessage(db *gorm.DB, message *models.Message) error {
	return db.Save(message).Error
}

func DeleteMessage(db *gorm.DB, id uint) error {
	return db.Delete(&models.Message{}, id).Error
}

func GetMessagesBetweenPaginated(db *gorm.DB, userID1, userID2 uint, limit int, beforeID *uint) ([]models.Message, error) {
	var messages []models.Message

	query := preloadMessageRelations(db).
		Where("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", userID1, userID2, userID2, userID1).
		Order("created_at DESC")

	if beforeID != nil {
		query = query.Where("id < ?", *beforeID)
	}

	err := query.Limit(limit).Find(&messages).Error

	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, err
}

func DeleteMessagesBatch(db *gorm.DB, ids []uint, userID uint) error {
	if len(ids) == 0 {
		return nil
	}

	var count int64
	db.Model(&models.Message{}).Where("id IN ? AND (from_id = ? OR to_id = ?)", ids, userID, userID).Count(&count)

	if int(count) != len(ids) {
		var foundIds []uint
		db.Model(&models.Message{}).Where("id IN ?", ids).Pluck("id", &foundIds)
		return errors.New("permission denied")
	}

	return db.Delete(&models.Message{}, ids).Error
}

func GetUnreadCount(db *gorm.DB, userID uint) (int64, error) {
	var count int64
	err := db.Model(&models.Message{}).Where("to_id = ? AND is_read = false AND deleted_at IS NULL", userID).Count(&count).Error
	return count, err
}
