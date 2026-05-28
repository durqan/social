package handlers

import (
	"errors"
	"fmt"
	"image"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func UploadMessageImage(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, services.ChatImageMaxRequestSize)

		file, err := c.FormFile("image")
		if err != nil {
			c.JSON(400, gin.H{"error": "image is required"})
			return
		}

		if file.Size > services.ChatImageMaxSize {
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
		ext, ok := services.ChatImageExtension(contentType)
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

		c.JSON(201, services.MessageAttachmentInput{
			FileURL:  services.PrivateUploadURL(filename),
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

		filePath, ok := services.ChatUploadPath(filename)
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

		filePath, ok := services.ChatUploadPath(filepath.Base(attachment.FileURL))
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
