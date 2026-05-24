package handlers

import (
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

const (
	chatImageMaxSize        = 10 << 20 // 10 MB
	chatImageMaxRequestSize = chatImageMaxSize + 1<<20
	chatImageMaxCount       = 5
	chatUploadURLPrefix     = "/api/messages/uploads/"
	chatAttachmentURLPrefix = "/api/messages/attachments/"
	legacyChatUploadPrefix  = "/uploads/chat/"
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

func normalizeMessageAttachments(input []messageAttachmentInput, userID uint) ([]models.MessageAttachment, error) {
	if len(input) > chatImageMaxCount {
		return nil, errors.New("too many images")
	}

	attachments := make([]models.MessageAttachment, 0, len(input))

	for _, item := range input {
		if item.FileType != "image" {
			return nil, errors.New("only image attachments are supported")
		}

		if !strings.HasPrefix(item.FileURL, chatUploadURLPrefix) && !strings.HasPrefix(item.FileURL, legacyChatUploadPrefix) {
			return nil, errors.New("invalid image url")
		}

		fileURL := filepath.ToSlash(filepath.Clean(item.FileURL))
		if !strings.HasPrefix(fileURL, chatUploadURLPrefix) && !strings.HasPrefix(fileURL, legacyChatUploadPrefix) {
			return nil, errors.New("invalid image url")
		}

		filename := filepath.Base(fileURL)
		if !strings.HasPrefix(filename, fmt.Sprintf("%d_", userID)) {
			return nil, errors.New("invalid image owner")
		}

		filePath := filepath.Join("uploads", "chat", filename)
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return nil, errors.New("image not found")
		}

		file, err := os.Open(filePath)
		if err != nil {
			return nil, errors.New("failed to read image")
		}

		cfg, _, err := image.DecodeConfig(file)
		_ = file.Close()
		if err != nil {
			return nil, errors.New("invalid image")
		}

		width := cfg.Width
		height := cfg.Height

		attachments = append(attachments, models.MessageAttachment{
			FileURL:  "/" + filepath.ToSlash(filePath),
			FileType: "image",
			Width:    &width,
			Height:   &height,
			Size:     info.Size(),
		})
	}

	return attachments, nil
}

func privateAttachmentURL(attachmentID uint) string {
	return fmt.Sprintf("%s%d", chatAttachmentURLPrefix, attachmentID)
}

func privateUploadURL(filename string) string {
	return chatUploadURLPrefix + filename
}

func withPrivateAttachmentURLs(message models.Message) models.Message {
	for i := range message.Attachments {
		message.Attachments[i].FileURL = privateAttachmentURL(message.Attachments[i].ID)
	}
	return message
}

func withPrivateAttachmentURLsForMessages(messages []models.Message) []models.Message {
	for i := range messages {
		messages[i] = withPrivateAttachmentURLs(messages[i])
	}
	return messages
}

func chatUploadPath(filename string) (string, bool) {
	if filename == "" || filename != filepath.Base(filename) {
		return "", false
	}
	return filepath.Join("uploads", "chat", filename), true
}

func UploadMessageImage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
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

		filename := fmt.Sprintf("%d_%d%s", userID, time.Now().UnixNano(), ext)
		savePath := filepath.Join(uploadDir, filename)

		if err := c.SaveUploadedFile(file, savePath); err != nil {
			c.JSON(500, gin.H{"error": "failed to save image"})
			return
		}

		c.JSON(201, messageAttachmentInput{
			FileURL:  privateUploadURL(filename),
			FileType: "image",
			Width:    cfg.Width,
			Height:   cfg.Height,
			Size:     file.Size,
		})
	}
}

func GetUploadedMessageImage() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		filename := c.Param("filename")
		if !strings.HasPrefix(filename, fmt.Sprintf("%d_", userID)) {
			c.JSON(403, gin.H{"error": "forbidden"})
			return
		}

		filePath, ok := chatUploadPath(filename)
		if !ok {
			c.JSON(400, gin.H{"error": "invalid filename"})
			return
		}

		if _, err := os.Stat(filePath); err != nil {
			c.JSON(404, gin.H{"error": "image not found"})
			return
		}

		c.File(filePath)
	}
}

func GetMessageAttachment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		attachmentID, ok := uintParam(c, "id", "invalid attachment id")
		if !ok {
			return
		}

		attachment, err := repository.GetMessageAttachmentForUser(db, attachmentID, userID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "attachment not found"})
				return
			}
			c.JSON(500, gin.H{"error": "failed to load attachment"})
			return
		}

		filePath, ok := chatUploadPath(filepath.Base(attachment.FileURL))
		if !ok {
			c.JSON(500, gin.H{"error": "invalid attachment path"})
			return
		}

		if _, err := os.Stat(filePath); err != nil {
			c.JSON(404, gin.H{"error": "attachment file not found"})
			return
		}

		c.File(filePath)
	}
}
