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
	if err := db.Create(message).Error; err != nil {
		return err
	}
	return UpsertConversationHeadsForMessage(db, message)
}

func CreateMessageAttachments(db *gorm.DB, attachments []models.MessageAttachment) error {
	if len(attachments) == 0 {
		return nil
	}

	return db.Create(&attachments).Error
}

func preloadMessageRelations(db *gorm.DB) *gorm.DB {
	query := db.
		Preload("From", preloadPublicUser).
		Preload("To", preloadPublicUser).
		Preload("Attachments").
		Preload("ReplyToMessage.From", preloadPublicUser).
		Preload("ReplyToMessage.Attachments").
		Preload("ForwardedFromUser", preloadPublicUser).
		Preload("ForwardedFromMessage.From", preloadPublicUser).
		Preload("ForwardedFromMessage.Attachments")
	if messageLinkPreviewTableExists(db) {
		query = query.
			Preload("LinkPreview").
			Preload("LinkPreview.VideoAttachment").
			Preload("ReplyToMessage.LinkPreview").
			Preload("ReplyToMessage.LinkPreview.VideoAttachment").
			Preload("ForwardedFromMessage.LinkPreview").
			Preload("ForwardedFromMessage.LinkPreview.VideoAttachment")
	}
	return query
}

func preloadPinnedMessageRelations(db *gorm.DB) *gorm.DB {
	query := db.
		Preload("Message.From", preloadPublicUser).
		Preload("Message.To", preloadPublicUser).
		Preload("Message.Attachments").
		Preload("Message.ReplyToMessage.From", preloadPublicUser).
		Preload("Message.ReplyToMessage.Attachments").
		Preload("Message.ForwardedFromUser", preloadPublicUser).
		Preload("Message.ForwardedFromMessage.From", preloadPublicUser).
		Preload("Message.ForwardedFromMessage.Attachments").
		Preload("PinnedBy", preloadPublicUser)
	if messageLinkPreviewTableExists(db) {
		query = query.
			Preload("Message.LinkPreview").
			Preload("Message.LinkPreview.VideoAttachment").
			Preload("Message.ReplyToMessage.LinkPreview").
			Preload("Message.ReplyToMessage.LinkPreview.VideoAttachment").
			Preload("Message.ForwardedFromMessage.LinkPreview").
			Preload("Message.ForwardedFromMessage.LinkPreview.VideoAttachment")
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

func GetMessageLinkPreviewForUser(db *gorm.DB, previewID, userID uint) (*models.MessageLinkPreview, error) {
	var preview models.MessageLinkPreview
	err := db.
		Joins("JOIN messages ON messages.id = message_link_previews.message_id").
		Where("message_link_previews.id = ? AND (messages.from_id = ? OR messages.to_id = ?)", previewID, userID, userID).
		First(&preview).Error
	return &preview, err
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
	return db.Transaction(func(tx *gorm.DB) error {
		pin := models.ConversationPin{
			UserID:         userID,
			ConversationID: conversationID,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "conversation_id"}},
			DoNothing: true,
		}).Create(&pin).Error; err != nil {
			return err
		}
		return SetConversationHeadPinned(tx, userID, conversationID, true)
	})
}

func UnpinConversation(db *gorm.DB, userID, conversationID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("user_id = ? AND conversation_id = ?", userID, conversationID).
			Delete(&models.ConversationPin{}).Error; err != nil {
			return err
		}
		return SetConversationHeadPinned(tx, userID, conversationID, false)
	})
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

func MarkMessagesAsRead(db *gorm.DB, fromID, toID uint) (int64, error) {
	var affected int64
	err := db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.Message{}).
			Where(`
				from_id = ? AND to_id = ? AND is_read = false
				AND NOT EXISTS (
					SELECT 1 FROM message_user_deletions mud
					WHERE mud.message_id = messages.id AND mud.user_id = ?
				)
			`, fromID, toID, toID).
			Update("is_read", true)
		if result.Error != nil {
			return result.Error
		}
		affected = result.RowsAffected
		return ResetConversationHeadUnread(tx, toID, fromID)
	})
	return affected, err
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

func MessageVisibleToUser(db *gorm.DB, messageID, userID uint) (bool, error) {
	if messageID == 0 || userID == 0 {
		return false, nil
	}

	var count int64
	err := db.Model(&models.Message{}).
		Where("id = ? AND (from_id = ? OR to_id = ?)", messageID, userID, userID).
		Where(`
			NOT EXISTS (
				SELECT 1 FROM message_user_deletions mud
				WHERE mud.message_id = messages.id AND mud.user_id = ?
			)
		`, userID).
		Count(&count).Error
	return count > 0, err
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

func DeleteMessageForEveryone(db *gorm.DB, id, deletedBy uint) error {
	var message models.Message
	if err := db.Unscoped().Select("id", "from_id", "to_id").First(&message, id).Error; err != nil {
		return err
	}

	now := time.Now()
	if err := db.Model(&models.Message{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"deleted_at":              now,
			"deleted_for_everyone_by": deletedBy,
		}).Error; err != nil {
		return err
	}
	return RefreshConversationHeadsAfterDeleteForEveryone(db, []models.Message{message})
}

func DeleteMessagesForEveryone(db *gorm.DB, ids []uint, deletedBy uint) error {
	if len(ids) == 0 {
		return nil
	}
	var messages []models.Message
	if err := db.Unscoped().
		Select("id", "from_id", "to_id").
		Where("id IN ?", ids).
		Find(&messages).Error; err != nil {
		return err
	}

	now := time.Now()
	if err := db.Model(&models.Message{}).
		Where("id IN ?", ids).
		Updates(map[string]interface{}{
			"deleted_at":              now,
			"deleted_for_everyone_by": deletedBy,
		}).Error; err != nil {
		return err
	}
	return RefreshConversationHeadsAfterDeleteForEveryone(db, messages)
}

func MarkMessageDeletedForUser(db *gorm.DB, messageID, userID uint) error {
	return MarkMessagesDeletedForUser(db, []uint{messageID}, userID)
}

func MarkMessagesDeletedForUser(db *gorm.DB, messageIDs []uint, userID uint) error {
	if len(messageIDs) == 0 {
		return nil
	}
	var messages []models.Message
	if err := db.
		Select("id", "from_id", "to_id").
		Where("id IN ? AND (from_id = ? OR to_id = ?)", messageIDs, userID, userID).
		Find(&messages).Error; err != nil {
		return err
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

	if err := db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "message_id"}, {Name: "user_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"deleted_at": now,
		}),
	}).Create(&deletions).Error; err != nil {
		return err
	}
	return RefreshConversationHeadsAfterDeleteForUser(db, messages, userID)
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
