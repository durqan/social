package repository

import (
	"errors"
	"fmt"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

type ConversationHeadListPage struct {
	Rows       []map[string]interface{}
	NextCursor *ConversationHeadCursor
}

type HydratedConversationHead struct {
	Head models.ConversationHead
	Row  map[string]interface{}
}

type conversationAttachmentFlags struct {
	MessageID              uint  `gorm:"column:message_id"`
	HasEncryptedAttachment int64 `gorm:"column:has_encrypted_attachment"`
	HasVideoNote           int64 `gorm:"column:has_video_note"`
	HasVoice               int64 `gorm:"column:has_voice"`
	HasVideo               int64 `gorm:"column:has_video"`
	HasAudio               int64 `gorm:"column:has_audio"`
	HasFile                int64 `gorm:"column:has_file"`
	HasImage               int64 `gorm:"column:has_image"`
}

// GetConversationsFromHeadsPage starts from the per-user conversation_heads
// index and hydrates all response data in fixed-size batch queries.
func GetConversationsFromHeadsPage(db *gorm.DB, userID uint, limit int, cursor *ConversationHeadCursor) (ConversationHeadListPage, error) {
	heads, hasMore, err := getConversationHeadsPageWithMore(db, userID, limit, cursor)
	if err != nil {
		return ConversationHeadListPage{}, err
	}

	hydrated, err := hydrateConversationHeads(db, heads)
	if err != nil {
		return ConversationHeadListPage{}, err
	}
	rows := make([]map[string]interface{}, 0, len(hydrated))
	for _, item := range hydrated {
		rows = append(rows, item.Row)
	}

	page := ConversationHeadListPage{Rows: rows}
	if hasMore && len(heads) > 0 {
		next := ConversationHeadCursorFrom(heads[len(heads)-1])
		page.NextCursor = &next
	}
	return page, nil
}

func GetHydratedConversationHeadsForPair(db *gorm.DB, firstUserID, secondUserID uint) ([]HydratedConversationHead, error) {
	if firstUserID == 0 || secondUserID == 0 || firstUserID == secondUserID {
		return nil, errors.New("invalid conversation participants")
	}

	var heads []models.ConversationHead
	err := db.Where(
		"(user_id = ? AND peer_user_id = ?) OR (user_id = ? AND peer_user_id = ?)",
		firstUserID,
		secondUserID,
		secondUserID,
		firstUserID,
	).Find(&heads).Error
	if err != nil {
		return nil, err
	}
	return hydrateConversationHeads(db, heads)
}

func hydrateConversationHeads(db *gorm.DB, heads []models.ConversationHead) ([]HydratedConversationHead, error) {
	if len(heads) == 0 {
		return []HydratedConversationHead{}, nil
	}

	messageIDs := make([]uint, 0, len(heads))
	seenMessageIDs := make(map[uint]struct{}, len(heads))
	for _, head := range heads {
		if head.LastMessageID == nil || *head.LastMessageID == 0 {
			continue
		}
		if _, exists := seenMessageIDs[*head.LastMessageID]; exists {
			continue
		}
		seenMessageIDs[*head.LastMessageID] = struct{}{}
		messageIDs = append(messageIDs, *head.LastMessageID)
	}

	messagesByID := make(map[uint]models.Message, len(messageIDs))
	if len(messageIDs) > 0 {
		var messages []models.Message
		if err := db.
			Select("id", "from_id", "to_id", "content", "encryption_version", "ciphertext", "nonce", "is_read", "created_at").
			Where("id IN ?", messageIDs).
			Find(&messages).Error; err != nil {
			return nil, err
		}
		for _, message := range messages {
			messagesByID[message.ID] = message
		}
	}

	userIDs := make([]uint, 0, len(heads)+len(messagesByID)+1)
	seenUserIDs := make(map[uint]struct{}, cap(userIDs))
	appendUserID := func(id uint) {
		if id == 0 {
			return
		}
		if _, exists := seenUserIDs[id]; exists {
			return
		}
		seenUserIDs[id] = struct{}{}
		userIDs = append(userIDs, id)
	}
	for _, head := range heads {
		appendUserID(head.UserID)
		appendUserID(head.PeerUserID)
	}
	for _, message := range messagesByID {
		appendUserID(message.FromID)
	}

	var users []models.User
	if err := db.
		Select("id", "name", "avatar", "avatar_position_x", "avatar_position_y", "avatar_scale", "updated_at", "last_seen_at").
		Where("id IN ?", userIDs).
		Find(&users).Error; err != nil {
		return nil, err
	}
	usersByID := make(map[uint]models.User, len(users))
	for _, user := range users {
		usersByID[user.ID] = user
	}

	flagsByMessageID := make(map[uint]conversationAttachmentFlags, len(messageIDs))
	if len(messageIDs) > 0 {
		var flags []conversationAttachmentFlags
		if err := db.Model(&models.MessageAttachment{}).
			Select(`message_id,
				MAX(CASE WHEN encryption_version > 0 THEN 1 ELSE 0 END) AS has_encrypted_attachment,
				MAX(CASE WHEN file_type = 'video_note' THEN 1 ELSE 0 END) AS has_video_note,
				MAX(CASE WHEN file_type = 'voice' THEN 1 ELSE 0 END) AS has_voice,
				MAX(CASE WHEN file_type = 'video' THEN 1 ELSE 0 END) AS has_video,
				MAX(CASE WHEN file_type = 'audio' THEN 1 ELSE 0 END) AS has_audio,
				MAX(CASE WHEN file_type = 'file' THEN 1 ELSE 0 END) AS has_file,
				MAX(CASE WHEN file_type = 'image' THEN 1 ELSE 0 END) AS has_image`).
			Where("message_id IN ?", messageIDs).
			Group("message_id").
			Scan(&flags).Error; err != nil {
			return nil, err
		}
		for _, item := range flags {
			flagsByMessageID[item.MessageID] = item
		}
	}

	rows := make([]HydratedConversationHead, 0, len(heads))
	for _, head := range heads {
		peer, exists := usersByID[head.PeerUserID]
		if !exists {
			return nil, fmt.Errorf("conversation head %d peer user %d not found", head.ConversationID, head.PeerUserID)
		}

		var message *models.Message
		if head.LastMessageID != nil {
			if hydrated, found := messagesByID[*head.LastMessageID]; found {
				message = &hydrated
			}
		}
		rows = append(rows, HydratedConversationHead{
			Head: head,
			Row: conversationHeadResponseRow(
				head,
				peer,
				message,
				usersByID,
				flagsByMessageID[valueOrZero(head.LastMessageID)],
				head.UserID,
			),
		})
	}
	return rows, nil
}

func conversationHeadResponseRow(
	head models.ConversationHead,
	peer models.User,
	message *models.Message,
	usersByID map[uint]models.User,
	flags conversationAttachmentFlags,
	userID uint,
) map[string]interface{} {
	row := map[string]interface{}{
		"conversation_id":         head.ConversationID,
		"user_id":                 head.PeerUserID,
		"name":                    peer.Name,
		"avatar":                  peer.Avatar,
		"avatar_position_x":       peer.AvatarPositionX,
		"avatar_position_y":       peer.AvatarPositionY,
		"avatar_scale":            peer.AvatarScale,
		"updated_at":              peer.UpdatedAt,
		"avatar_updated_at":       peer.UpdatedAt,
		"last_seen_at":            nullableTimeValue(peer.LastSeenAt),
		"last_message_id":         nil,
		"last_message_content":    "",
		"last_encryption_version": 0,
		"last_ciphertext":         "",
		"last_nonce":              "",
		"last_message":            "",
		"last_message_at":         nullableTimeValue(head.LastMessageAt),
		"last_sender_id":          uint(0),
		"last_sender_name":        "",
		"last_is_mine":            false,
		"last_read":               false,
		"unread_count":            head.UnreadCount,
		"is_pinned":               head.IsPinned,
	}
	if message == nil {
		return row
	}

	row["last_message_id"] = message.ID
	row["last_message_content"] = message.Content
	row["last_encryption_version"] = message.EncryptionVersion
	row["last_ciphertext"] = message.Ciphertext
	row["last_nonce"] = message.Nonce
	row["last_message"] = conversationLastMessagePreview(*message, flags)
	row["last_sender_id"] = message.FromID
	row["last_is_mine"] = message.FromID == userID
	row["last_read"] = message.IsRead
	if sender, exists := usersByID[message.FromID]; exists {
		row["last_sender_name"] = sender.Name
	}
	return row
}

func conversationLastMessagePreview(message models.Message, flags conversationAttachmentFlags) string {
	if message.EncryptionVersion > 0 || flags.HasEncryptedAttachment > 0 {
		return "Зашифрованное сообщение"
	}
	if message.Content != "" {
		return message.Content
	}
	switch {
	case flags.HasVideoNote > 0:
		return "Видео-сообщение"
	case flags.HasVoice > 0:
		return "Голосовое сообщение"
	case flags.HasVideo > 0:
		return "Видео"
	case flags.HasAudio > 0:
		return "Аудио"
	case flags.HasFile > 0:
		return "Файл"
	case flags.HasImage > 0:
		return "Изображение"
	default:
		return ""
	}
}

func nullableTimeValue(value *time.Time) interface{} {
	if value == nil {
		return nil
	}
	return *value
}
