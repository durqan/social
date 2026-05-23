package handlers

import (
	_ "image/jpeg"
	_ "image/png"
	"strconv"
	"tester/internal/models"
	"tester/internal/repository"

	"errors"
	"fmt"
	"image"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	chatImageMaxSize        = 10 << 20 // 10 MB
	chatImageMaxRequestSize = chatImageMaxSize + 1<<20
	chatImageMaxCount       = 5
)

type messageAttachmentInput struct {
	ID        uint   `json:"id,omitempty"`
	MessageID uint   `json:"message_id,omitempty"`
	FileURL   string `json:"file_url"`
	FileType  string `json:"file_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	Size      int64  `json:"size"`
}

var allowedChatImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

func normalizeMessageAttachments(input []messageAttachmentInput) ([]models.MessageAttachment, error) {
	if len(input) > chatImageMaxCount {
		return nil, errors.New("too many images")
	}

	attachments := make([]models.MessageAttachment, 0, len(input))

	for _, item := range input {
		if item.FileType != "image" {
			return nil, errors.New("only image attachments are supported")
		}

		if !strings.HasPrefix(item.FileURL, "/uploads/chat/") {
			return nil, errors.New("invalid image url")
		}

		attachments = append(attachments, models.MessageAttachment{
			FileURL:  item.FileURL,
			FileType: "image",
			Width:    &item.Width,
			Height:   &item.Height,
			Size:     item.Size,
		})
	}

	return attachments, nil
}

func UploadMessageImage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists || userID == nil {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, chatImageMaxRequestSize)

		file, err := c.FormFile("image")
		if err != nil {
			c.JSON(400, gin.H{"error": "image is required"})
			return
		}

		if file.Size > chatImageMaxSize {
			c.JSON(413, gin.H{"error": "image is too large"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read image"})
			return
		}
		defer src.Close()

		buf := make([]byte, 512)
		n, err := src.Read(buf)
		if err != nil && n == 0 {
			c.JSON(400, gin.H{"error": "failed to read image"})
			return
		}

		contentType := http.DetectContentType(buf[:n])
		ext, ok := allowedChatImageTypes[contentType]
		if !ok {
			c.JSON(415, gin.H{"error": "image must be jpeg, png or webp"})
			return
		}

		if _, err := src.Seek(0, 0); err != nil {
			c.JSON(400, gin.H{"error": "failed to read image"})
			return
		}

		cfg, _, err := image.DecodeConfig(src)
		if err != nil {
			c.JSON(415, gin.H{"error": "invalid image"})
			return
		}

		uploadDir := filepath.Join("uploads", "chat")
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload directory"})
			return
		}

		filename := fmt.Sprintf("%d_%d%s", userID.(uint), time.Now().UnixNano(), ext)
		savePath := filepath.Join(uploadDir, filename)

		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(500, gin.H{"error": "failed to save image"})
			return
		}

		c.JSON(201, messageAttachmentInput{
			FileURL:  "/" + filepath.ToSlash(savePath),
			FileType: "image",
			Width:    cfg.Width,
			Height:   cfg.Height,
			Size:     file.Size,
		})
	}
}

func SendMessage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		toID, err := strconv.ParseUint(c.Param("toId"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
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
		attachments, err := normalizeMessageAttachments(req.Attachments)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if content == "" && len(attachments) == 0 {
			c.JSON(400, gin.H{"error": "message content or image is required"})
			return
		}

		message := models.Message{
			FromID:  userID.(uint),
			ToID:    uint(toID),
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

		db.Preload("From").Preload("To").Preload("Attachments").First(&message, message.ID)
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
		if limit < 1 || limit > 100 {
			limit = 20
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
