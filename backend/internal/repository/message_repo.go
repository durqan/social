package repository

import (
	"errors"
	"tester/internal/models"

	"gorm.io/gorm"
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

func GetConversations(db *gorm.DB, userID uint) ([]map[string]interface{}, error) {
	var conversations []map[string]interface{}

	err := db.Raw(`
        SELECT 
            user_id,
            name,
            last_message,
            last_message_at,
            unread_count
        FROM (
            SELECT 
                CASE 
                    WHEN m.from_id = ? THEN m.to_id
                    ELSE m.from_id
                END as user_id,
                u.name,
                m.content as last_message,
                m.created_at as last_message_at,
                (
                    SELECT COUNT(*) FROM messages 
                    WHERE to_id = ? AND from_id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END 
                    AND is_read = false
                ) as unread_count,
                ROW_NUMBER() OVER (
                    PARTITION BY CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END 
                    ORDER BY m.created_at DESC
                ) as rn
            FROM messages m
            JOIN users u ON u.id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END
            WHERE m.from_id = ? OR m.to_id = ?
        ) subq
        WHERE rn = 1
        ORDER BY last_message_at DESC
    `, userID, userID, userID, userID, userID, userID, userID).
		Scan(&conversations).Error

	return conversations, err
}

func MarkMessagesAsRead(db *gorm.DB, fromID, toID uint) error {
	return db.Model(&models.Message{}).
		Where("from_id = ? AND to_id = ? AND is_read = false", fromID, toID).
		Update("is_read", true).Error
}

func GetMessageByID(db *gorm.DB, id uint) (*models.Message, error) {
	var message models.Message
	err := db.Preload("From").Preload("To").Preload("Attachments").Preload("Attachments").First(&message, id).Error
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

	query := db.Preload("From").Preload("To").Preload("Attachments").Preload("Attachments").
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
	err := db.Model(&models.Message{}).Where("to_id = ? AND is_read = false", userID).Count(&count).Error
	return count, err
}
