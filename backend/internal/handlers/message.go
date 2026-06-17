package handlers

import (
	"errors"
	"strconv"

	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SendMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		toID, ok := uintParam(c, "toId", "invalid user id")
		if !ok {
			return
		}

		var req struct {
			Content                string                            `json:"content"`
			Attachments            []services.MessageAttachmentInput `json:"attachments"`
			ReplyToMessageID       *uint                             `json:"replyToMessageId"`
			ReplyToMessageIDLegacy *uint                             `json:"reply_to_message_id"`
			EncryptionVersion      int                               `json:"encryption_version"`
			EncryptionVersionCamel int                               `json:"encryptionVersion"`
			Ciphertext             string                            `json:"ciphertext"`
			Nonce                  string                            `json:"nonce"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		attachments, err := services.NormalizeMessageAttachments(req.Attachments, userID)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		replyToMessageID := req.ReplyToMessageID
		if replyToMessageID == nil {
			replyToMessageID = req.ReplyToMessageIDLegacy
		}

		message, err := services.SendMessage(db, userID, toID, req.Content, attachments, replyToMessageID, requestEncryption(req.EncryptionVersion, req.EncryptionVersionCamel, req.Ciphertext, req.Nonce))
		if errors.Is(err, services.ErrMessageContentRequired) {
			c.JSON(400, gin.H{"error": "message content or attachment is required"})
			return
		}
		if errors.Is(err, services.ErrMessageContentTooLong) {
			c.JSON(400, gin.H{"error": "message content must be 1000 characters or less"})
			return
		}
		if errors.Is(err, services.ErrMessageNotFriends) {
			c.JSON(403, gin.H{"error": "can only message accepted friends"})
			return
		}
		if errors.Is(err, services.ErrMessageInvalidReply) {
			c.JSON(400, gin.H{"error": "reply message must belong to this conversation"})
			return
		}
		if errors.Is(err, services.ErrMessageInvalidEncryption) {
			c.JSON(400, gin.H{"error": "invalid encrypted message payload"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to send message"})
			return
		}

		broadcastNewMessage(c.Request.Context(), message)

		c.JSON(201, services.WithPrivateAttachmentURLs(message))
	}
}

func ForwardMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		messageID, ok := uintParam(c, "messageId", "invalid message id")
		if !ok {
			return
		}

		var req struct {
			ToUserIDsLegacy   []uint `json:"to_user_ids"`
			ToUserIDs         []uint `json:"toUserIds"`
			EncryptedMessages []struct {
				ToUserID               uint                              `json:"toUserId"`
				ToUserIDLegacy         uint                              `json:"to_user_id"`
				EncryptionVersion      int                               `json:"encryption_version"`
				EncryptionVersionCamel int                               `json:"encryptionVersion"`
				Ciphertext             string                            `json:"ciphertext"`
				Nonce                  string                            `json:"nonce"`
				Attachments            []services.MessageAttachmentInput `json:"attachments"`
			} `json:"encryptedMessages"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		toUserIDs := req.ToUserIDs
		if len(toUserIDs) == 0 {
			toUserIDs = req.ToUserIDsLegacy
		}
		if len(toUserIDs) == 0 && len(req.EncryptedMessages) > 0 {
			for _, item := range req.EncryptedMessages {
				toUserID := item.ToUserID
				if toUserID == 0 {
					toUserID = item.ToUserIDLegacy
				}
				toUserIDs = append(toUserIDs, toUserID)
			}
		}
		if len(toUserIDs) == 0 || len(toUserIDs) > 20 {
			c.JSON(400, gin.H{"error": "select between 1 and 20 recipients"})
			return
		}

		var messages []models.Message
		var err error
		if len(req.EncryptedMessages) > 0 {
			inputs := make([]services.EncryptedForwardInput, 0, len(req.EncryptedMessages))
			for _, item := range req.EncryptedMessages {
				toUserID := item.ToUserID
				if toUserID == 0 {
					toUserID = item.ToUserIDLegacy
				}
				attachments, err := services.NormalizeMessageAttachments(item.Attachments, userID)
				if err != nil {
					c.JSON(400, gin.H{"error": err.Error()})
					return
				}
				inputs = append(inputs, services.EncryptedForwardInput{
					ToUserID:    toUserID,
					Encryption:  requestEncryption(item.EncryptionVersion, item.EncryptionVersionCamel, item.Ciphertext, item.Nonce),
					Attachments: attachments,
				})
			}
			messages, err = services.ForwardEncryptedMessage(db, userID, messageID, inputs)
		} else {
			messages, err = services.ForwardMessage(db, userID, messageID, toUserIDs)
		}
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you do not have access to this message"})
			return
		}
		if errors.Is(err, services.ErrMessageNotFriends) {
			c.JSON(403, gin.H{"error": "can only forward messages to accepted friends"})
			return
		}
		if errors.Is(err, services.ErrMessageEncryptedForwardUnsupported) {
			c.JSON(400, gin.H{"error": "encrypted messages must be forwarded by the client"})
			return
		}
		if errors.Is(err, services.ErrMessageInvalidEncryption) {
			c.JSON(400, gin.H{"error": "invalid encrypted message payload"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to forward message"})
			return
		}

		for _, message := range messages {
			broadcastNewMessage(c.Request.Context(), message)
		}

		c.JSON(201, gin.H{"messages": services.WithPrivateAttachmentURLsForMessages(messages)})
	}
}

func GetMessagesWith(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		otherID, ok := uintParam(c, "userId", "invalid user id")
		if !ok {
			return
		}

		limit := 20
		if l := c.Query("limit"); l != "" {
			limit, _ = strconv.Atoi(l)
		}
		if limit < 1 || limit > 100 {
			limit = 20
		}

		var beforeID *uint
		if before := c.Query("before"); before != "" {
			id, _ := strconv.ParseUint(before, 10, 32)
			beforeID = new(uint)
			*beforeID = uint(id)
		}

		messages, err := repository.GetMessagesBetweenPaginated(db, userID, otherID, limit, beforeID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get messages"})
			return
		}

		c.JSON(200, gin.H{
			"messages": services.WithPrivateAttachmentURLsForMessages(messages),
			"has_more": len(messages) == limit,
		})
	}
}

func GetConversations(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		conversations, err := repository.GetConversations(db, userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get conversations"})
			return
		}
		for i := range conversations {
			if avatar, ok := conversations[i]["avatar"].(string); ok {
				conversations[i]["avatar"] = dto.AvatarEndpoint(conversationUserID(conversations[i]["user_id"]), avatar)
			}
		}

		c.JSON(200, conversations)
	}
}

func PinConversation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		conversationID, ok := uintParam(c, "conversationId", "invalid conversation id")
		if !ok {
			return
		}

		participant, err := repository.ConversationExistsForUser(db, userID, conversationID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to pin conversation"})
			return
		}
		if !participant {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}

		if err := repository.PinConversation(db, userID, conversationID); err != nil {
			c.JSON(500, gin.H{"error": "failed to pin conversation"})
			return
		}

		services.InvalidateMessageCaches()
		c.JSON(200, gin.H{"is_pinned": true})
	}
}

func UnpinConversation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		conversationID, ok := uintParam(c, "conversationId", "invalid conversation id")
		if !ok {
			return
		}

		participant, err := repository.ConversationExistsForUser(db, userID, conversationID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to unpin conversation"})
			return
		}
		if !participant {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}

		if err := repository.UnpinConversation(db, userID, conversationID); err != nil {
			c.JSON(500, gin.H{"error": "failed to unpin conversation"})
			return
		}

		services.InvalidateMessageCaches()
		c.JSON(200, gin.H{"is_pinned": false})
	}
}

func GetPinnedMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		conversationID, ok := uintParam(c, "conversationId", "invalid conversation id")
		if !ok {
			return
		}

		pin, err := services.GetPinnedMessage(db, userID, conversationID)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get pinned message"})
			return
		}

		c.JSON(200, gin.H{"pinned_message": pinnedMessageResponse(pin)})
	}
}

func PinMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		conversationID, ok := uintParam(c, "conversationId", "invalid conversation id")
		if !ok {
			return
		}
		messageID, ok := uintParam(c, "messageId", "invalid message id")
		if !ok {
			return
		}

		pin, err := services.PinMessage(db, userID, conversationID, messageID)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}
		if errors.Is(err, services.ErrMessageInvalidPin) {
			c.JSON(400, gin.H{"error": "message must belong to this conversation and not be deleted"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to pin message"})
			return
		}

		broadcastMessagePinned(c.Request.Context(), pin)
		c.JSON(200, gin.H{"pinned_message": pinnedMessageResponse(pin)})
	}
}

func UnpinMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		conversationID, ok := uintParam(c, "conversationId", "invalid conversation id")
		if !ok {
			return
		}

		pin, err := services.UnpinMessage(db, userID, conversationID)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to unpin message"})
			return
		}

		if pin != nil {
			broadcastMessageUnpinned(c.Request.Context(), pin.ConversationID, pin.MessageID, pin.Message.FromID, pin.Message.ToID)
		}
		c.JSON(200, gin.H{"pinned_message": nil})
	}
}

func pinnedMessageResponse(pin *models.PinnedMessage) interface{} {
	if pin == nil {
		return nil
	}

	return gin.H{
		"id":              pin.ID,
		"conversation_id": pin.ConversationID,
		"message_id":      pin.MessageID,
		"pinned_by_id":    pin.PinnedByID,
		"created_at":      pin.CreatedAt,
		"message":         services.WithPrivateAttachmentURLs(pin.Message),
		"pinned_by":       dto.ToPublicUser(pin.PinnedBy),
	}
}

func requestEncryption(versionSnake, versionCamel int, ciphertext, nonce string) services.MessageEncryptionInput {
	version := versionSnake
	if version == 0 {
		version = versionCamel
	}
	return services.MessageEncryptionInput{
		Version:    version,
		Ciphertext: ciphertext,
		Nonce:      nonce,
	}
}

func conversationUserID(value interface{}) uint {
	switch v := value.(type) {
	case uint:
		return v
	case uint64:
		return uint(v)
	case uint32:
		return uint(v)
	case int:
		if v < 0 {
			return 0
		}
		return uint(v)
	case int64:
		if v < 0 {
			return 0
		}
		return uint(v)
	case int32:
		if v < 0 {
			return 0
		}
		return uint(v)
	case float64:
		if v < 0 {
			return 0
		}
		return uint(v)
	case []byte:
		id, err := strconv.ParseUint(string(v), 10, 32)
		if err != nil {
			return 0
		}
		return uint(id)
	case string:
		id, err := strconv.ParseUint(v, 10, 32)
		if err != nil {
			return 0
		}
		return uint(id)
	default:
		return 0
	}
}

func UpdateMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		messageID, ok := uintParam(c, "messageId", "invalid message id")
		if !ok {
			return
		}

		var req struct {
			Content                string `json:"content"`
			EncryptionVersion      int    `json:"encryption_version"`
			EncryptionVersionCamel int    `json:"encryptionVersion"`
			Ciphertext             string `json:"ciphertext"`
			Nonce                  string `json:"nonce"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		message, err := services.UpdateMessage(db, userID, messageID, req.Content, requestEncryption(req.EncryptionVersion, req.EncryptionVersionCamel, req.Ciphertext, req.Nonce))
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "can only edit your own messages"})
			return
		}
		if errors.Is(err, services.ErrMessageContentRequired) || errors.Is(err, services.ErrMessageContentTooLong) {
			c.JSON(400, gin.H{"error": "message content must be between 1 and 1000 characters"})
			return
		}
		if errors.Is(err, services.ErrMessageInvalidEncryption) {
			c.JSON(400, gin.H{"error": "invalid encrypted message payload"})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to update message"})
			return
		}

		broadcastMessageUpdate(c.Request.Context(), message)

		c.JSON(200, services.WithPrivateAttachmentURLs(message))
	}
}

func DeleteMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		messageID, ok := uintParam(c, "messageId", "invalid message id")
		if !ok {
			return
		}

		mode, ok := messageDeleteMode(c)
		if !ok {
			return
		}

		var pinnedMessages []models.PinnedMessage
		if mode == services.MessageDeleteForEveryone {
			var err error
			pinnedMessages, err = repository.GetPinnedMessagesByMessageIDs(db, []uint{messageID})
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to delete message"})
				return
			}
		}

		message, err := services.DeleteMessageForUser(db, userID, messageID, mode)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to delete message"})
			return
		}

		if mode == services.MessageDeleteForEveryone {
			broadcastMessageDelete(c.Request.Context(), messageID, message.FromID, message.ToID)
			for _, pin := range pinnedMessages {
				broadcastMessageUnpinned(c.Request.Context(), pin.ConversationID, pin.MessageID, pin.Message.FromID, pin.Message.ToID)
			}
		} else {
			broadcastMessageDelete(c.Request.Context(), messageID, userID)
		}

		c.JSON(200, gin.H{"message": "deleted", "mode": mode})
	}
}

func DeleteMessagesBatch(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		var req struct {
			MessageIDs []uint `json:"message_ids" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "invalid request"})
			return
		}

		if len(req.MessageIDs) == 0 {
			c.JSON(400, gin.H{"error": "no messages specified"})
			return
		}

		mode, ok := messageDeleteMode(c)
		if !ok {
			return
		}

		var pinnedMessages []models.PinnedMessage
		if mode == services.MessageDeleteForEveryone {
			var err error
			pinnedMessages, err = repository.GetPinnedMessagesByMessageIDs(db, req.MessageIDs)
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to delete messages"})
				return
			}
		}

		messages, err := services.DeleteMessagesBatchForUser(db, req.MessageIDs, userID, mode)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "permission denied"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to delete messages"})
			return
		}

		for _, message := range messages {
			if mode == services.MessageDeleteForEveryone {
				broadcastMessageDelete(c.Request.Context(), message.ID, message.FromID, message.ToID)
			} else {
				broadcastMessageDelete(c.Request.Context(), message.ID, userID)
			}
		}
		if mode == services.MessageDeleteForEveryone {
			for _, pin := range pinnedMessages {
				broadcastMessageUnpinned(c.Request.Context(), pin.ConversationID, pin.MessageID, pin.Message.FromID, pin.Message.ToID)
			}
		}

		c.JSON(200, gin.H{"message": "deleted", "mode": mode})
	}
}

func messageDeleteMode(c *gin.Context) (services.MessageDeleteMode, bool) {
	mode, ok := services.ParseMessageDeleteMode(c.Query("mode"))
	if !ok {
		c.JSON(400, gin.H{"error": "invalid delete mode"})
		return "", false
	}
	return mode, true
}

func GetUnreadCount(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		count, err := repository.GetUnreadCount(db, userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get unread count"})
			return
		}

		c.JSON(200, gin.H{"unread_count": count})
	}
}

func MarkMessagesAsRead(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		fromID, ok := uintParam(c, "userId", "invalid user id")
		if !ok {
			return
		}

		if err := services.MarkConversationRead(db, fromID, userID); err != nil {
			c.JSON(500, gin.H{"error": "failed to mark as read"})
			return
		}
		sendMessageReadReceipt(c.Request.Context(), userID, fromID)
		sendConversationReadSync(c.Request.Context(), userID, fromID)
		enqueueMessageReadSync(db, userID, fromID)

		c.JSON(200, gin.H{"message": "marked as read"})
	}
}
