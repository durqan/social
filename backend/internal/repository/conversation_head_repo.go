package repository

import (
	"errors"
	"sort"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	defaultConversationHeadPageSize = 50
	maxConversationHeadPageSize     = 100
)

var ErrInvalidConversationHeadCursor = errors.New("invalid conversation head cursor")

type ConversationHeadCursor struct {
	IsPinned       bool
	LastMessageAt  *time.Time
	ConversationID uint
}

type ConversationHeadOwner struct {
	UserID     uint
	PeerUserID uint
}

// GetConversationHeadOwnersByLastMessageIDs identifies only heads whose list
// projection can change when the supplied messages are deleted or edited.
func GetConversationHeadOwnersByLastMessageIDs(db *gorm.DB, messageIDs []uint) ([]ConversationHeadOwner, error) {
	if len(messageIDs) == 0 {
		return []ConversationHeadOwner{}, nil
	}

	var owners []ConversationHeadOwner
	err := db.Model(&models.ConversationHead{}).
		Select("user_id", "peer_user_id").
		Where("last_message_id IN ?", messageIDs).
		Scan(&owners).Error
	return owners, err
}

func ConversationHeadCursorFrom(head models.ConversationHead) ConversationHeadCursor {
	return ConversationHeadCursor{
		IsPinned:       head.IsPinned,
		LastMessageAt:  head.LastMessageAt,
		ConversationID: head.ConversationID,
	}
}

// UpsertConversationHeadsForMessage updates both participant rows. The
// recipient's unread counter is incremented in the same upsert that advances
// the last-message pointer.
func UpsertConversationHeadsForMessage(db *gorm.DB, message *models.Message) error {
	if message == nil || message.ID == 0 || message.FromID == 0 || message.ToID == 0 || message.FromID == message.ToID {
		return errors.New("invalid message participants")
	}

	messageID := message.ID
	messageAt := message.CreatedAt
	recipientUnread := int64(1)
	if message.IsRead {
		recipientUnread = 0
	}

	rows := []models.ConversationHead{
		{
			ConversationID: message.ID,
			UserID:         message.FromID,
			PeerUserID:     message.ToID,
			LastMessageID:  &messageID,
			LastMessageAt:  &messageAt,
			UnreadCount:    0,
			CreatedAt:      messageAt,
		},
		{
			ConversationID: message.ID,
			UserID:         message.ToID,
			PeerUserID:     message.FromID,
			LastMessageID:  &messageID,
			LastMessageAt:  &messageAt,
			UnreadCount:    recipientUnread,
			CreatedAt:      messageAt,
		},
	}

	// Opposite-direction messages can be created concurrently. Lock participant
	// rows in a stable order to avoid taking the two unique keys in reverse order.
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].UserID < rows[j].UserID
	})

	for i := range rows {
		if err := upsertConversationHeadForMessage(db, &rows[i]); err != nil {
			return err
		}
	}
	return nil
}

func upsertConversationHeadForMessage(db *gorm.DB, head *models.ConversationHead) error {
	earlierAnchor := `excluded.created_at < conversation_heads.created_at
		OR (excluded.created_at = conversation_heads.created_at
			AND excluded.conversation_id < conversation_heads.conversation_id)`
	newerMessage := `conversation_heads.last_message_at IS NULL
		OR excluded.last_message_at > conversation_heads.last_message_at
		OR (excluded.last_message_at = conversation_heads.last_message_at
			AND excluded.last_message_id > conversation_heads.last_message_id)`

	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "peer_user_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"conversation_id": gorm.Expr("CASE WHEN " + earlierAnchor + " THEN excluded.conversation_id ELSE conversation_heads.conversation_id END"),
			"created_at":      gorm.Expr("CASE WHEN " + earlierAnchor + " THEN excluded.created_at ELSE conversation_heads.created_at END"),
			"last_message_id": gorm.Expr("CASE WHEN " + newerMessage + " THEN excluded.last_message_id ELSE conversation_heads.last_message_id END"),
			"last_message_at": gorm.Expr("CASE WHEN " + newerMessage + " THEN excluded.last_message_at ELSE conversation_heads.last_message_at END"),
			"unread_count":    gorm.Expr("conversation_heads.unread_count + excluded.unread_count"),
			"updated_at":      gorm.Expr("excluded.updated_at"),
		}),
	}).Create(head).Error
}

// ResetConversationHeadUnread derives the value from visible unread messages.
// Usually it becomes zero; deriving it keeps a concurrently committed new
// message from being lost by a blind reset.
func ResetConversationHeadUnread(db *gorm.DB, userID, peerUserID uint) error {
	unread, err := conversationUnreadCount(db, userID, peerUserID)
	if err != nil {
		return err
	}

	result := db.Model(&models.ConversationHead{}).
		Where("user_id = ? AND peer_user_id = ?", userID, peerUserID).
		Updates(map[string]interface{}{
			"unread_count": unread,
			"updated_at":   time.Now(),
		})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	err = rebuildConversationHeadForUser(db, userID, peerUserID, nil)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	return err
}

func SetConversationHeadPinned(db *gorm.DB, userID, peerUserID uint, pinned bool) error {
	result := db.Model(&models.ConversationHead{}).
		Where("user_id = ? AND peer_user_id = ?", userID, peerUserID).
		Updates(map[string]interface{}{
			"is_pinned":  pinned,
			"updated_at": time.Now(),
		})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return rebuildConversationHeadForUser(db, userID, peerUserID, &pinned)
}

func getConversationHeadsPageWithMore(db *gorm.DB, userID uint, limit int, cursor *ConversationHeadCursor) ([]models.ConversationHead, bool, error) {
	limit = normalizeConversationHeadPageSize(limit)
	heads, err := findConversationHeadsPage(
		db.Where("last_message_id IS NOT NULL"),
		userID,
		limit+1,
		cursor,
	)
	if err != nil {
		return nil, false, err
	}
	hasMore := len(heads) > limit
	if hasMore {
		heads = heads[:limit]
	}
	return heads, hasMore, nil
}

func normalizeConversationHeadPageSize(limit int) int {
	if limit <= 0 {
		return defaultConversationHeadPageSize
	}
	if limit > maxConversationHeadPageSize {
		return maxConversationHeadPageSize
	}
	return limit
}

func findConversationHeadsPage(db *gorm.DB, userID uint, limit int, cursor *ConversationHeadCursor) ([]models.ConversationHead, error) {
	query := db.Where("user_id = ?", userID)
	if cursor != nil {
		if cursor.ConversationID == 0 {
			return nil, ErrInvalidConversationHeadCursor
		}
		query = applyConversationHeadCursor(query, *cursor)
	}

	var heads []models.ConversationHead
	err := query.
		Order(conversationHeadOrder(db)).
		Limit(limit).
		Find(&heads).Error
	return heads, err
}

func applyConversationHeadCursor(query *gorm.DB, cursor ConversationHeadCursor) *gorm.DB {
	var afterSQL string
	var afterArgs []interface{}
	if cursor.LastMessageAt == nil {
		afterSQL = "last_message_at IS NULL AND conversation_id < ?"
		afterArgs = []interface{}{cursor.ConversationID}
	} else {
		afterSQL = `(last_message_at < ?
			OR (last_message_at = ? AND conversation_id < ?)
			OR last_message_at IS NULL)`
		afterArgs = []interface{}{*cursor.LastMessageAt, *cursor.LastMessageAt, cursor.ConversationID}
	}

	if cursor.IsPinned {
		args := []interface{}{true}
		args = append(args, afterArgs...)
		args = append(args, false)
		return query.Where("((is_pinned = ? AND ("+afterSQL+")) OR is_pinned = ?)", args...)
	}

	args := []interface{}{false}
	args = append(args, afterArgs...)
	return query.Where("is_pinned = ? AND ("+afterSQL+")", args...)
}

func conversationHeadOrder(db *gorm.DB) string {
	if db.Dialector.Name() == "postgres" {
		return "is_pinned DESC, last_message_at DESC NULLS LAST, conversation_id DESC"
	}
	return "is_pinned DESC, last_message_at DESC, conversation_id DESC"
}

func RefreshConversationHeadsAfterDeleteForEveryone(db *gorm.DB, messages []models.Message) error {
	return refreshConversationHeadsAfterDelete(db, messages, 0)
}

func RefreshConversationHeadsAfterDeleteForUser(db *gorm.DB, messages []models.Message, userID uint) error {
	if userID == 0 {
		return errors.New("invalid conversation head user")
	}
	return refreshConversationHeadsAfterDelete(db, messages, userID)
}

type conversationHeadRefreshKey struct {
	UserID     uint
	PeerUserID uint
}

func refreshConversationHeadsAfterDelete(db *gorm.DB, messages []models.Message, onlyUserID uint) error {
	deletedByHead := make(map[conversationHeadRefreshKey]map[uint]struct{})
	for _, message := range messages {
		if message.ID == 0 || message.FromID == 0 || message.ToID == 0 || message.FromID == message.ToID {
			continue
		}

		participants := []conversationHeadRefreshKey{
			{UserID: message.FromID, PeerUserID: message.ToID},
			{UserID: message.ToID, PeerUserID: message.FromID},
		}
		for _, participant := range participants {
			if onlyUserID != 0 && participant.UserID != onlyUserID {
				continue
			}
			if deletedByHead[participant] == nil {
				deletedByHead[participant] = make(map[uint]struct{})
			}
			deletedByHead[participant][message.ID] = struct{}{}
		}
	}

	keys := make([]conversationHeadRefreshKey, 0, len(deletedByHead))
	for key := range deletedByHead {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].UserID == keys[j].UserID {
			return keys[i].PeerUserID < keys[j].PeerUserID
		}
		return keys[i].UserID < keys[j].UserID
	})

	for _, key := range keys {
		if err := refreshConversationHeadAfterDelete(db, key, deletedByHead[key]); err != nil {
			return err
		}
	}
	return nil
}

func refreshConversationHeadAfterDelete(db *gorm.DB, key conversationHeadRefreshKey, deletedIDs map[uint]struct{}) error {
	var head models.ConversationHead
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("user_id = ? AND peer_user_id = ?", key.UserID, key.PeerUserID).
		First(&head).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return rebuildConversationHeadForUser(db, key.UserID, key.PeerUserID, nil)
	}
	if err != nil {
		return err
	}

	unread, err := conversationUnreadCount(db, key.UserID, key.PeerUserID)
	if err != nil {
		return err
	}
	_, deletedLast := deletedIDs[valueOrZero(head.LastMessageID)]
	if !deletedLast {
		if unread == head.UnreadCount {
			return nil
		}
		return db.Model(&models.ConversationHead{}).
			Where("conversation_id = ? AND user_id = ?", head.ConversationID, head.UserID).
			Updates(map[string]interface{}{
				"unread_count": unread,
				"updated_at":   time.Now(),
			}).Error
	}

	lastMessageID, lastMessageAt, err := latestVisibleConversationMessage(db, key.UserID, key.PeerUserID)
	if err != nil {
		return err
	}
	return db.Model(&models.ConversationHead{}).
		Where("conversation_id = ? AND user_id = ?", head.ConversationID, head.UserID).
		Updates(map[string]interface{}{
			"last_message_id": lastMessageID,
			"last_message_at": lastMessageAt,
			"unread_count":    unread,
			"updated_at":      time.Now(),
		}).Error
}

func rebuildConversationHeadForUser(db *gorm.DB, userID, peerUserID uint, pinnedOverride *bool) error {
	anchor, err := earliestConversationMessage(db, userID, peerUserID)
	if err != nil {
		return err
	}
	lastMessageID, lastMessageAt, err := latestVisibleConversationMessage(db, userID, peerUserID)
	if err != nil {
		return err
	}
	unread, err := conversationUnreadCount(db, userID, peerUserID)
	if err != nil {
		return err
	}
	pinned, err := conversationPinned(db, userID, peerUserID)
	if err != nil {
		return err
	}
	if pinnedOverride != nil {
		pinned = *pinnedOverride
	}

	head := models.ConversationHead{
		ConversationID: anchor.ID,
		UserID:         userID,
		PeerUserID:     peerUserID,
		LastMessageID:  lastMessageID,
		LastMessageAt:  lastMessageAt,
		UnreadCount:    unread,
		IsPinned:       pinned,
		CreatedAt:      anchor.CreatedAt,
	}
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}, {Name: "peer_user_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"conversation_id": gorm.Expr("excluded.conversation_id"),
			"created_at":      gorm.Expr("excluded.created_at"),
			"last_message_id": gorm.Expr("excluded.last_message_id"),
			"last_message_at": gorm.Expr("excluded.last_message_at"),
			"unread_count":    gorm.Expr("excluded.unread_count"),
			"is_pinned":       gorm.Expr("excluded.is_pinned"),
			"updated_at":      gorm.Expr("excluded.updated_at"),
		}),
	}).Create(&head).Error
}

func earliestConversationMessage(db *gorm.DB, userID, peerUserID uint) (*models.Message, error) {
	var message models.Message
	err := db.Unscoped().
		Select("id", "created_at").
		Where("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", userID, peerUserID, peerUserID, userID).
		Order("created_at ASC, id ASC").
		First(&message).Error
	return &message, err
}

func latestVisibleConversationMessage(db *gorm.DB, userID, peerUserID uint) (*uint, *time.Time, error) {
	var message models.Message
	err := db.
		Select("id", "created_at").
		Where("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", userID, peerUserID, peerUserID, userID).
		Where(`NOT EXISTS (
			SELECT 1 FROM message_user_deletions mud
			WHERE mud.message_id = messages.id AND mud.user_id = ?
		)`, userID).
		Order("created_at DESC, id DESC").
		First(&message).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	messageID := message.ID
	messageAt := message.CreatedAt
	return &messageID, &messageAt, nil
}

func conversationUnreadCount(db *gorm.DB, userID, peerUserID uint) (int64, error) {
	var count int64
	err := db.Model(&models.Message{}).
		Where("from_id = ? AND to_id = ? AND is_read = false", peerUserID, userID).
		Where(`NOT EXISTS (
			SELECT 1 FROM message_user_deletions mud
			WHERE mud.message_id = messages.id AND mud.user_id = ?
		)`, userID).
		Count(&count).Error
	return count, err
}

func conversationPinned(db *gorm.DB, userID, peerUserID uint) (bool, error) {
	var count int64
	err := db.Model(&models.ConversationPin{}).
		Where("user_id = ? AND conversation_id = ?", userID, peerUserID).
		Count(&count).Error
	return count > 0, err
}

func valueOrZero(value *uint) uint {
	if value == nil {
		return 0
	}
	return *value
}
