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

		message, err := services.SendMessage(db, userID, toID, req.Content, attachments, replyToMessageID)
		if errors.Is(err, services.ErrMessageContentRequired) {
			c.JSON(400, gin.H{"error": "message content or image is required"})
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
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to send message"})
			return
		}

		publishNotification(toID, userID, dto.NotificationTypeMessage, message.ID)
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
			ToUserIDsLegacy []uint `json:"to_user_ids"`
			ToUserIDs       []uint `json:"toUserIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		toUserIDs := req.ToUserIDs
		if len(toUserIDs) == 0 {
			toUserIDs = req.ToUserIDsLegacy
		}
		if len(toUserIDs) == 0 || len(toUserIDs) > 20 {
			c.JSON(400, gin.H{"error": "select between 1 and 20 recipients"})
			return
		}

		messages, err := services.ForwardMessage(db, userID, messageID, toUserIDs)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "you do not have access to this message"})
			return
		}
		if errors.Is(err, services.ErrMessageNotFriends) {
			c.JSON(403, gin.H{"error": "can only forward messages to accepted friends"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to forward message"})
			return
		}

		for _, message := range messages {
			publishNotification(message.ToID, userID, dto.NotificationTypeMessage, message.ID)
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
			Content string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		content, ok := trimAndValidateContent(req.Content, maxMessageContentLength)
		if !ok {
			c.JSON(400, gin.H{"error": "message content must be between 1 and 1000 characters"})
			return
		}

		message, err := services.UpdateMessage(db, userID, messageID, content)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "can only edit your own messages"})
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

		var message models.Message
		if err := db.Select("id", "from_id", "to_id").First(&message, messageID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "message not found"})
				return
			}
			c.JSON(500, gin.H{"error": "failed to delete message"})
			return
		}

		err := services.DeleteMessageForUser(db, userID, messageID)
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

		broadcastMessageDelete(c.Request.Context(), messageID, message.FromID, message.ToID)

		c.JSON(200, gin.H{"message": "deleted for both"})
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

		messages, err := services.DeleteMessagesBatchForUser(db, req.MessageIDs, userID)
		if errors.Is(err, services.ErrMessageForbidden) {
			c.JSON(403, gin.H{"error": "permission denied"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to delete messages"})
			return
		}

		for _, message := range messages {
			broadcastMessageDelete(c.Request.Context(), message.ID, message.FromID, message.ToID)
		}

		c.JSON(200, gin.H{"message": "deleted"})
	}
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

		c.JSON(200, gin.H{"message": "marked as read"})
	}
}
