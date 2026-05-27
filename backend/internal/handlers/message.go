package handlers

import (
	"strconv"
	"strings"

	"tester/internal/cache"
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func invalidateMessageCaches() {
	if cache.Redis == nil {
		return
	}

	_ = cache.Redis.DeletePattern("cache:/messages*")
}

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
			Content     string                   `json:"content"`
			Attachments []messageAttachmentInput `json:"attachments"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		content := strings.TrimSpace(req.Content)
		attachments, err := normalizeMessageAttachments(req.Attachments, userID)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if content == "" && len(attachments) == 0 {
			c.JSON(400, gin.H{"error": "message content or image is required"})
			return
		}

		message := models.Message{
			FromID:  userID,
			ToID:    toID,
			Content: content,
		}

		if err := repository.CreateMessage(db, &message); err != nil {
			c.JSON(500, gin.H{"error": "failed to send message"})
			return
		}

		for i := range attachments {
			attachments[i].MessageID = message.ID
		}

		if err := repository.CreateMessageAttachments(db, attachments); err != nil {
			c.JSON(500, gin.H{"error": "failed to attach images"})
			return
		}

		publishNotification(toID, userID, dto.NotificationTypeMessage, message.ID)

		db.Preload("From").Preload("To").Preload("Attachments").First(&message, message.ID)
		c.JSON(201, withPrivateAttachmentURLs(message))
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
			"messages": withPrivateAttachmentURLsForMessages(messages),
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

		c.JSON(200, conversations)
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

		message, err := repository.GetMessageByID(db, messageID)
		if err != nil {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}

		if message.FromID != userID {
			c.JSON(403, gin.H{"error": "can only edit your own messages"})
			return
		}

		content, ok := trimAndValidateContent(req.Content, maxMessageContentLength)
		if !ok {
			c.JSON(400, gin.H{"error": "message content must be between 1 and 1000 characters"})
			return
		}

		message.Content = content
		if err := repository.UpdateMessage(db, message); err != nil {
			c.JSON(500, gin.H{"error": "failed to update message"})
			return
		}

		db.Preload("From").Preload("To").First(&message, messageID)
		c.JSON(200, message)
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

		message, err := repository.GetMessageByID(db, messageID)
		if err != nil {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}

		if message.FromID != userID && message.ToID != userID {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}

		if err := repository.DeleteMessage(db, messageID); err != nil {
			c.JSON(500, gin.H{"error": "failed to delete message"})
			return
		}

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

		if err := repository.DeleteMessagesBatch(db, req.MessageIDs, userID); err != nil {
			c.JSON(403, gin.H{"error": err.Error()})
			return
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

		if err := repository.MarkMessagesAsRead(db, fromID, userID); err != nil {
			c.JSON(500, gin.H{"error": "failed to mark as read"})
			return
		}
		invalidateMessageCaches()
		sendMessageReadReceipt(c.Request.Context(), userID, fromID)

		c.JSON(200, gin.H{"message": "marked as read"})
	}
}
