package handlers

import (
	"strconv"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SendMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		toID, err := strconv.ParseUint(c.Param("toId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		var req struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		message := models.Message{
			FromID:  userID.(uint),
			ToID:    uint(toID),
			Content: req.Content,
		}

		if err := repository.CreateMessage(db, &message); err != nil {
			c.JSON(500, gin.H{"error": "failed to send message"})
			return
		}

		db.Preload("From").Preload("To").First(&message, message.ID)
		c.JSON(201, message)
	}
}

func GetMessagesWith(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		otherID, err := strconv.ParseUint(c.Param("userId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		limit := 20
		if l := c.Query("limit"); l != "" {
			limit, _ = strconv.Atoi(l)
		}

		var beforeID *uint
		if before := c.Query("before"); before != "" {
			id, _ := strconv.ParseUint(before, 10, 32)
			beforeID = new(uint)
			*beforeID = uint(id)
		}

		messages, err := repository.GetMessagesBetweenPaginated(db, userID.(uint), uint(otherID), limit, beforeID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get messages"})
			return
		}

		repository.MarkMessagesAsRead(db, uint(otherID), userID.(uint))

		c.JSON(200, gin.H{
			"messages": messages,
			"has_more": len(messages) == limit,
		})
	}
}

func GetConversations(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")

		conversations, err := repository.GetConversations(db, userID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get conversations"})
			return
		}

		c.JSON(200, conversations)
	}
}

func UpdateMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		messageID, err := strconv.ParseUint(c.Param("messageId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid message id"})
			return
		}

		var req struct {
			Content string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		message, err := repository.GetMessageByID(db, uint(messageID))
		if err != nil {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}

		if message.FromID != userID.(uint) {
			c.JSON(403, gin.H{"error": "can only edit your own messages"})
			return
		}

		message.Content = req.Content
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
		userID, _ := c.Get("user_id")
		messageID, err := strconv.ParseUint(c.Param("messageId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid message id"})
			return
		}

		message, err := repository.GetMessageByID(db, uint(messageID))
		if err != nil {
			c.JSON(404, gin.H{"error": "message not found"})
			return
		}

		if message.FromID != userID.(uint) && message.ToID != userID.(uint) {
			c.JSON(403, gin.H{"error": "you are not a participant in this conversation"})
			return
		}

		if err := repository.DeleteMessage(db, uint(messageID)); err != nil {
			c.JSON(500, gin.H{"error": "failed to delete message"})
			return
		}

		c.JSON(200, gin.H{"message": "deleted for both"})
	}
}

func DeleteMessagesBatch(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")

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

		if err := repository.DeleteMessagesBatch(db, req.MessageIDs, userID.(uint)); err != nil {
			c.JSON(403, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "deleted"})
	}
}

func GetUnreadCount(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")

		count, err := repository.GetUnreadCount(db, userID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get unread count"})
			return
		}

		c.JSON(200, gin.H{"unread_count": count})
	}
}

func MarkMessagesAsRead(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		fromID, err := strconv.ParseUint(c.Param("userId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		if err := repository.MarkMessagesAsRead(db, uint(fromID), userID.(uint)); err != nil {
			c.JSON(500, gin.H{"error": "failed to mark as read"})
			return
		}

		c.JSON(200, gin.H{"message": "marked as read"})
	}
}
