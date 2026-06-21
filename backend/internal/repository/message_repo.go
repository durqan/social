package repository

import (
	"errors"
	"fmt"
	"sync"
	"tester/internal/models"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var messageLinkPreviewTableCache sync.Map

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
	query := db.
		Preload("From").
		Preload("To").
		Preload("Attachments").
		Preload("ReplyToMessage.From").
		Preload("ReplyToMessage.Attachments").
		Preload("ForwardedFromUser").
		Preload("ForwardedFromMessage.From").
		Preload("ForwardedFromMessage.Attachments")
	if messageLinkPreviewTableExists(db) {
		query = query.
			Preload("LinkPreview").
			Preload("ReplyToMessage.LinkPreview").
			Preload("ForwardedFromMessage.LinkPreview")
	}
	return query
}

func preloadPinnedMessageRelations(db *gorm.DB) *gorm.DB {
	query := db.
		Preload("Message.From").
		Preload("Message.To").
		Preload("Message.Attachments").
		Preload("Message.ReplyToMessage.From").
		Preload("Message.ReplyToMessage.Attachments").
		Preload("Message.ForwardedFromUser").
		Preload("Message.ForwardedFromMessage.From").
		Preload("Message.ForwardedFromMessage.Attachments").
		Preload("PinnedBy")
	if messageLinkPreviewTableExists(db) {
		query = query.
			Preload("Message.LinkPreview").
			Preload("Message.ReplyToMessage.LinkPreview").
			Preload("Message.ForwardedFromMessage.LinkPreview")
	}
	return query
}

func messageLinkPreviewTableExists(db *gorm.DB) bool {
	cacheKey := fmt.Sprintf("%p", db.Config)
	if cached, ok := messageLinkPreviewTableCache.Load(cacheKey); ok {
		return cached.(bool)
	}

	exists := db.Migrator().HasTable(&models.MessageLinkPreview{})
	messageLinkPreviewTableCache.Store(cacheKey, exists)
	return exists
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
        WITH visible_messages AS (
            SELECT 
                m.*,
                CASE 
                    WHEN m.from_id = ? THEN m.to_id
                    ELSE m.from_id
                END AS peer_user_id
            FROM messages m
            WHERE (m.from_id = ? OR m.to_id = ?)
              AND m.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM message_user_deletions mud
                  WHERE mud.message_id = m.id AND mud.user_id = ?
              )
        ),
        ranked_messages AS (
            SELECT 
                vm.*,
                ROW_NUMBER() OVER (
                    PARTITION BY vm.peer_user_id
                    ORDER BY vm.created_at DESC, vm.id DESC
                ) AS rn
            FROM visible_messages vm
        ),
        last_messages AS (
            SELECT * FROM ranked_messages WHERE rn = 1
        ),
        attachment_flags AS (
            SELECT
                ma.message_id,
                MAX(CASE WHEN ma.encryption_version > 0 THEN 1 ELSE 0 END) AS has_encrypted_attachment,
                MAX(CASE WHEN ma.file_type = 'video_note' THEN 1 ELSE 0 END) AS has_video_note,
                MAX(CASE WHEN ma.file_type = 'voice' THEN 1 ELSE 0 END) AS has_voice,
                MAX(CASE WHEN ma.file_type = 'video' THEN 1 ELSE 0 END) AS has_video,
                MAX(CASE WHEN ma.file_type = 'audio' THEN 1 ELSE 0 END) AS has_audio,
                MAX(CASE WHEN ma.file_type = 'file' THEN 1 ELSE 0 END) AS has_file,
                MAX(CASE WHEN ma.file_type = 'image' THEN 1 ELSE 0 END) AS has_image
            FROM message_attachments ma
            JOIN last_messages lm ON lm.id = ma.message_id
            GROUP BY ma.message_id
        ),
        unread_counts AS (
            SELECT
                m.from_id AS peer_user_id,
                COUNT(*) AS unread_count
            FROM messages m
            WHERE m.to_id = ?
              AND m.is_read = false
              AND m.deleted_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM message_user_deletions mud
                  WHERE mud.message_id = m.id AND mud.user_id = ?
              )
            GROUP BY m.from_id
        )
        SELECT 
                lm.peer_user_id as user_id,
                u.name,
                u.avatar,
                u.avatar_position_x,
                u.avatar_position_y,
                u.avatar_scale,
                u.updated_at,
                u.updated_at as avatar_updated_at,
                u.last_seen_at,
                lm.id as last_message_id,
                lm.content as last_message_content,
                lm.encryption_version as last_encryption_version,
                lm.ciphertext as last_ciphertext,
                lm.nonce as last_nonce,
                CASE
                    WHEN lm.encryption_version > 0 OR COALESCE(af.has_encrypted_attachment, 0) = 1 THEN 'Зашифрованное сообщение'
                    ELSE COALESCE(
                        NULLIF(lm.content, ''),
                        CASE
                            WHEN COALESCE(af.has_video_note, 0) = 1 THEN 'Видео-сообщение'
                            WHEN COALESCE(af.has_voice, 0) = 1 THEN 'Голосовое сообщение'
                            WHEN COALESCE(af.has_video, 0) = 1 THEN 'Видео'
                            WHEN COALESCE(af.has_audio, 0) = 1 THEN 'Аудио'
                            WHEN COALESCE(af.has_file, 0) = 1 THEN 'Файл'
                            WHEN COALESCE(af.has_image, 0) = 1 THEN 'Изображение'
                            ELSE ''
                        END
                    )
                END as last_message,
                lm.created_at as last_message_at,
                lm.from_id as last_sender_id,
                sender.name as last_sender_name,
                (lm.from_id = ?) as last_is_mine,
                lm.is_read as last_read,
                COALESCE(uc.unread_count, 0) as unread_count,
                (cp.id IS NOT NULL) as is_pinned
            FROM last_messages lm
            JOIN users u ON u.id = lm.peer_user_id
            JOIN users sender ON sender.id = lm.from_id
            LEFT JOIN attachment_flags af ON af.message_id = lm.id
            LEFT JOIN unread_counts uc ON uc.peer_user_id = lm.peer_user_id
            LEFT JOIN conversation_pins cp
                ON cp.user_id = ?
                AND cp.conversation_id = lm.peer_user_id
        ORDER BY is_pinned DESC, last_message_at DESC
    `, userID, userID, userID, userID, userID, userID, userID, userID).
		Scan(&conversations).Error
	normalizeScannedMapValues(conversations)

	return conversations, err
}

func normalizeScannedMapValues(rows []map[string]interface{}) {
	for _, row := range rows {
		for key, value := range row {
			if pointer, ok := value.(*interface{}); ok {
				if pointer == nil {
					row[key] = nil
					continue
				}
				row[key] = *pointer
			}
		}
	}
}

func ConversationExistsForUser(db *gorm.DB, userID, conversationID uint) (bool, error) {
	if userID == 0 || conversationID == 0 || userID == conversationID {
		return false, nil
	}

	var count int64
	err := db.Model(&models.Message{}).
		Where(
			`((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
				AND deleted_at IS NULL
				AND NOT EXISTS (
					SELECT 1 FROM message_user_deletions mud
					WHERE mud.message_id = messages.id AND mud.user_id = ?
				)`,
			userID,
			conversationID,
			conversationID,
			userID,
			userID,
		).
		Count(&count).Error

	return count > 0, err
}

func CanonicalConversationID(db *gorm.DB, userID, conversationUserID uint) (uint, error) {
	var message models.Message
	err := db.Unscoped().
		Select("id").
		Where(
			"(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)",
			userID,
			conversationUserID,
			conversationUserID,
			userID,
		).
		Order("created_at ASC, id ASC").
		First(&message).Error
	if err != nil {
		return 0, err
	}
	return message.ID, nil
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

func GetPinnedMessage(db *gorm.DB, conversationID uint) (*models.PinnedMessage, error) {
	var pin models.PinnedMessage
	err := preloadPinnedMessageRelations(db).
		Joins("JOIN messages ON messages.id = pinned_messages.message_id AND messages.deleted_at IS NULL").
		Where("pinned_messages.conversation_id = ?", conversationID).
		First(&pin).Error
	return &pin, err
}

func GetPinnedMessageForUser(db *gorm.DB, conversationID, userID uint) (*models.PinnedMessage, error) {
	var pin models.PinnedMessage
	err := preloadPinnedMessageRelations(db).
		Joins("JOIN messages ON messages.id = pinned_messages.message_id AND messages.deleted_at IS NULL").
		Where("pinned_messages.conversation_id = ?", conversationID).
		Where(`
			NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = pinned_messages.message_id AND mud.user_id = ?
			)
		`, userID).
		First(&pin).Error
	if err == nil {
		err = hideDeletedMessageRelationsForUser(db, userID, &pin.Message)
	}
	return &pin, err
}

func GetPinnedMessagesByMessageIDs(db *gorm.DB, messageIDs []uint) ([]models.PinnedMessage, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	var pins []models.PinnedMessage
	err := preloadPinnedMessageRelations(db).
		Where("message_id IN ?", messageIDs).
		Find(&pins).Error
	return pins, err
}

func ReplacePinnedMessage(db *gorm.DB, conversationID, messageID, pinnedByID uint) (*models.PinnedMessage, error) {
	pin := models.PinnedMessage{
		ConversationID: conversationID,
		MessageID:      messageID,
		PinnedByID:     pinnedByID,
		CreatedAt:      time.Now(),
	}

	if err := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "conversation_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"message_id":   pin.MessageID,
			"pinned_by_id": pin.PinnedByID,
			"created_at":   pin.CreatedAt,
		}),
	}).Create(&pin).Error; err != nil {
		return nil, err
	}

	return GetPinnedMessage(db, conversationID)
}

func DeletePinnedMessage(db *gorm.DB, conversationID uint) error {
	return db.Where("conversation_id = ?", conversationID).Delete(&models.PinnedMessage{}).Error
}

func DeletePinnedMessagesByMessageIDs(db *gorm.DB, messageIDs []uint) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return db.Where("message_id IN ?", messageIDs).Delete(&models.PinnedMessage{}).Error
}

func MarkMessagesAsRead(db *gorm.DB, fromID, toID uint) error {
	return db.Model(&models.Message{}).
		Where(`
			from_id = ? AND to_id = ? AND is_read = false
			AND NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, fromID, toID, toID).
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
		Where(`
			NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID).
		First(&message).Error
	if err == nil {
		err = hideDeletedMessageRelationsForUser(db, userID, &message)
	}
	return &message, err
}

func GetMessageByIDForDelete(db *gorm.DB, id uint, includeDeleted bool) (*models.Message, error) {
	var message models.Message
	query := preloadMessageRelations(db)
	if includeDeleted {
		query = query.Unscoped()
	}
	err := query.First(&message, id).Error
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
		Where(`
			NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID1).
		First(&message).Error
	if err == nil {
		err = hideDeletedMessageRelationsForUser(db, userID1, &message)
	}
	return &message, err
}

func UpdateMessage(db *gorm.DB, message *models.Message) error {
	return db.Save(message).Error
}

func DeleteMessage(db *gorm.DB, id uint) error {
	return db.Delete(&models.Message{}, id).Error
}

func DeleteMessageForEveryone(db *gorm.DB, id, deletedBy uint) error {
	now := time.Now()
	return db.Model(&models.Message{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"deleted_at":              now,
			"deleted_for_everyone_by": deletedBy,
		}).Error
}

func DeleteMessagesForEveryone(db *gorm.DB, ids []uint, deletedBy uint) error {
	if len(ids) == 0 {
		return nil
	}

	now := time.Now()
	return db.Model(&models.Message{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"deleted_at":              now,
			"deleted_for_everyone_by": deletedBy,
		}).Error
}

func MarkMessageDeletedForUser(db *gorm.DB, messageID, userID uint) error {
	return MarkMessagesDeletedForUser(db, []uint{messageID}, userID)
}

func MarkMessagesDeletedForUser(db *gorm.DB, messageIDs []uint, userID uint) error {
	if len(messageIDs) == 0 {
		return nil
	}

	now := time.Now()
	deletions := make([]models.MessageUserDeletion, 0, len(messageIDs))
	for _, messageID := range messageIDs {
		deletions = append(deletions, models.MessageUserDeletion{
			MessageID: messageID,
			UserID:    userID,
			DeletedAt: now,
		})
	}

	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "message_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"deleted_at": now,
		}),
	}).Create(&deletions).Error
}

func GetMessagesBetweenPaginated(db *gorm.DB, userID1, userID2 uint, limit int, beforeID *uint) ([]models.Message, error) {
	var messages []models.Message

	query := preloadMessageRelations(db).
		Where("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", userID1, userID2, userID2, userID1).
		Where(`
			NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID1).
		Order("created_at DESC, id DESC")

	if beforeID != nil {
		var err error
		query, err = applyMessageBeforeCursor(db, query, userID1, userID2, *beforeID)
		if err != nil {
			return nil, err
		}
	}

	err := query.Limit(limit).Find(&messages).Error
	if err != nil {
		return nil, err
	}
	messagePointers := make([]*models.Message, 0, len(messages))
	for i := range messages {
		messagePointers = append(messagePointers, &messages[i])
	}
	if err := hideDeletedMessageRelationsForUser(db, userID1, messagePointers...); err != nil {
		return nil, err
	}
	if err := AttachReactionSummaries(db, messages, userID1); err != nil {
		return nil, err
	}

	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, err
}

func applyMessageBeforeCursor(db *gorm.DB, query *gorm.DB, userID1, userID2, beforeID uint) (*gorm.DB, error) {
	if beforeID == 0 {
		return query.Where("1 = 0"), nil
	}

	var cursor struct {
		ID        uint
		CreatedAt time.Time
	}
	err := db.Model(&models.Message{}).
		Select("id", "created_at").
		Where("id = ? AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))", beforeID, userID1, userID2, userID2, userID1).
		Where(`
			deleted_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID1).
		First(&cursor).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return query.Where("1 = 0"), nil
	}
	if err != nil {
		return nil, err
	}

	return query.Where(
		"(created_at < ? OR (created_at = ? AND id < ?))",
		cursor.CreatedAt,
		cursor.CreatedAt,
		cursor.ID,
	), nil
}

func ToggleMessageReaction(db *gorm.DB, messageID, userID uint, emoji string) error {
	var reaction models.MessageReaction
	err := db.Where("message_id = ? AND user_id = ?", messageID, userID).First(&reaction).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&models.MessageReaction{
			MessageID: messageID,
			UserID:    userID,
			Emoji:     emoji,
		}).Error
	}
	if err != nil {
		return err
	}
	if reaction.Emoji == emoji {
		return db.Delete(&reaction).Error
	}
	return db.Model(&reaction).Update("emoji", emoji).Error
}

func GetReactionSummaries(db *gorm.DB, messageID, currentUserID uint) ([]models.ReactionSummary, error) {
	var reactions []models.MessageReaction
	if err := db.
		Select("user_id", "emoji").
		Where("message_id = ?", messageID).
		Order("created_at ASC, id ASC").
		Find(&reactions).Error; err != nil {
		return nil, err
	}

	summaries := make([]models.ReactionSummary, 0, len(reactions))
	indexByEmoji := make(map[string]int, len(reactions))
	for _, reaction := range reactions {
		if index, ok := indexByEmoji[reaction.Emoji]; ok {
			summaries[index].Count++
			if reaction.UserID == currentUserID {
				summaries[index].ReactedByMe = true
			}
			continue
		}
		indexByEmoji[reaction.Emoji] = len(summaries)
		summaries = append(summaries, models.ReactionSummary{
			Emoji:       reaction.Emoji,
			Count:       1,
			ReactedByMe: reaction.UserID == currentUserID,
		})
	}
	return summaries, nil
}

func AttachReactionSummaries(db *gorm.DB, messages []models.Message, currentUserID uint) error {
	if len(messages) == 0 {
		return nil
	}

	messageIDs := make([]uint, 0, len(messages))
	messageIndex := make(map[uint]int, len(messages))
	for i := range messages {
		messageIDs = append(messageIDs, messages[i].ID)
		messageIndex[messages[i].ID] = i
		messages[i].Reactions = []models.ReactionSummary{}
	}

	var reactions []models.MessageReaction
	if err := db.
		Select("message_id", "user_id", "emoji").
		Where("message_id IN ?", messageIDs).
		Order("created_at ASC, id ASC").
		Find(&reactions).Error; err != nil {
		return err
	}

	summaryIndexes := make(map[uint]map[string]int, len(messages))
	for _, reaction := range reactions {
		messagePosition, ok := messageIndex[reaction.MessageID]
		if !ok {
			continue
		}
		if summaryIndexes[reaction.MessageID] == nil {
			summaryIndexes[reaction.MessageID] = make(map[string]int)
		}
		if summaryPosition, ok := summaryIndexes[reaction.MessageID][reaction.Emoji]; ok {
			summary := &messages[messagePosition].Reactions[summaryPosition]
			summary.Count++
			if reaction.UserID == currentUserID {
				summary.ReactedByMe = true
			}
			continue
		}
		summaryIndexes[reaction.MessageID][reaction.Emoji] = len(messages[messagePosition].Reactions)
		messages[messagePosition].Reactions = append(messages[messagePosition].Reactions, models.ReactionSummary{
			Emoji:       reaction.Emoji,
			Count:       1,
			ReactedByMe: reaction.UserID == currentUserID,
		})
	}
	return nil
}

func hideDeletedMessageRelationsForUser(db *gorm.DB, userID uint, messages ...*models.Message) error {
	relatedIDs := make([]uint, 0, len(messages)*2)
	seen := make(map[uint]struct{}, len(messages)*2)
	for _, message := range messages {
		if message == nil {
			continue
		}
		if message.ReplyToMessageID != nil {
			id := *message.ReplyToMessageID
			if _, exists := seen[id]; !exists {
				seen[id] = struct{}{}
				relatedIDs = append(relatedIDs, id)
			}
		}
		if message.ForwardedFromMessageID != nil {
			id := *message.ForwardedFromMessageID
			if _, exists := seen[id]; !exists {
				seen[id] = struct{}{}
				relatedIDs = append(relatedIDs, id)
			}
		}
	}
	if len(relatedIDs) == 0 {
		return nil
	}

	var hiddenIDs []uint
	if err := db.Model(&models.MessageUserDeletion{}).
		Where("user_id = ? AND message_id IN ?", userID, relatedIDs).
		Pluck("message_id", &hiddenIDs).Error; err != nil {
		return err
	}
	hidden := make(map[uint]struct{}, len(hiddenIDs))
	for _, id := range hiddenIDs {
		hidden[id] = struct{}{}
	}

	for _, message := range messages {
		if message == nil {
			continue
		}
		if message.ReplyToMessageID != nil {
			if _, exists := hidden[*message.ReplyToMessageID]; exists {
				message.ReplyToMessage = nil
			}
		}
		if message.ForwardedFromMessageID != nil {
			if _, exists := hidden[*message.ForwardedFromMessageID]; exists {
				message.ForwardedFromMessage = nil
			}
		}
	}
	return nil
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
	err := db.Model(&models.Message{}).
		Where(`
			to_id = ? AND is_read = false AND deleted_at IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID, userID).
		Count(&count).Error
	return count, err
}
