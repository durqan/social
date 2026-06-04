package handlers

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"tester/internal/repository"
	"tester/internal/services"
	"tester/internal/storage"

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
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				c.JSON(413, gin.H{"error": "image is too large"})
				return
			}

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

		if _, err := src.Seek(0, 0); err != nil {
			c.JSON(400, gin.H{"error": "failed to read image"})
			return
		}

		key, err := storage.NewObjectKey(fmt.Sprintf("messages/user_%d", userID), ext)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create image filename"})
			return
		}
		filename := filepath.Base(key)

		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		if err := store.Upload(c.Request.Context(), key, src, contentType); err != nil {
			c.JSON(500, gin.H{"error": "failed to save image"})
			return
		}
		services.RememberChatUploadOwner(filename, userID)

		c.JSON(201, services.MessageAttachmentInput{
			FileURL:  services.PrivateUploadURL(filename),
			FileType: "image",
			Width:    cfg.Width,
			Height:   cfg.Height,
			Size:     file.Size,
		})
	}
}

func UploadMessageVoice(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, services.ChatVoiceMaxRequestSize)

		file, err := c.FormFile("voice")
		if err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				c.JSON(413, gin.H{"error": "voice is too large"})
				return
			}

			c.JSON(400, gin.H{"error": "voice is required"})
			return
		}

		if file.Size <= 0 {
			c.JSON(400, gin.H{"error": "voice is required"})
			return
		}
		if file.Size > services.ChatVoiceMaxSize {
			c.JSON(413, gin.H{"error": "voice is too large"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read voice"})
			return
		}
		defer src.Close()

		data, err := io.ReadAll(src)
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read voice"})
			return
		}
		if int64(len(data)) > services.ChatVoiceMaxSize {
			c.JSON(413, gin.H{"error": "voice is too large"})
			return
		}

		contentType, ext, err := services.ValidateChatVoiceUpload(data, file.Header.Get("Content-Type"))
		if err != nil {
			c.JSON(415, gin.H{"error": err.Error()})
			return
		}

		durationSeconds, hasDuration := voiceDurationSecondsFromForm(c)
		if !hasDuration {
			c.JSON(400, gin.H{"error": "voice duration is required"})
			return
		}
		durationSeconds, err = services.ValidateChatVoiceDurationSeconds(durationSeconds)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		key, err := storage.NewObjectKey(fmt.Sprintf("voice/user_%d", userID), ext)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create voice filename"})
			return
		}
		filename := filepath.Base(key)

		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		if err := store.Upload(c.Request.Context(), key, bytes.NewReader(data), contentType); err != nil {
			c.JSON(500, gin.H{"error": "failed to save voice"})
			return
		}
		services.RememberChatUploadOwner(filename, userID)

		c.JSON(201, services.MessageAttachmentInput{
			AttachmentID:    strings.TrimSuffix(filename, filepath.Ext(filename)),
			FileURL:         services.PrivateUploadURL(filename),
			FileType:        "voice",
			Duration:        durationSeconds,
			DurationSeconds: durationSeconds,
			Size:            int64(len(data)),
		})
	}
}

func voiceDurationSecondsFromForm(c *gin.Context) (int, bool) {
	for _, key := range []string{"duration", "duration_seconds"} {
		if duration, ok := services.ParseChatVoiceDurationSeconds(c.PostForm(key)); ok {
			return duration, true
		}
	}
	return 0, false
}

func videoNoteDurationSecondsFromForm(c *gin.Context) (int, bool) {
	for _, key := range []string{"duration", "duration_seconds"} {
		if duration, ok := services.ParseChatVideoNoteDurationSeconds(c.PostForm(key)); ok {
			return duration, true
		}
	}
	return 0, false
}

func GetUploadedMessageImage() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		filename := c.Param("filename")
		if !services.ChatUploadOwnedBy(filename, userID) {
			c.JSON(403, gin.H{"error": "forbidden"})
			return
		}

		key, ok := services.ChatUploadKeyFromFilename(filename, userID)
		if !ok {
			c.JSON(400, gin.H{"error": "invalid filename"})
			return
		}
		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to load storage"})
			return
		}

		serveStoredObject(c, store, key)
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

		key, ok := services.AttachmentObjectKey(attachment.FileURL)
		if !ok {
			c.JSON(500, gin.H{"error": "invalid attachment path"})
			return
		}
		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to load storage"})
			return
		}

		serveStoredObject(c, store, key)
	}
}

func contentTypeForKey(key string) string {
	ext := strings.ToLower(filepath.Ext(key))
	switch ext {
	case ".webm":
		return "video/webm"
	case ".mp4":
		return "video/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

func serveStoredObject(c *gin.Context, store storage.Storage, key string) {
	contentType := contentTypeForKey(key)
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", "inline")
	c.Header("Accept-Ranges", "bytes")

	if filePath, ok := storage.LocalPath(store, key); ok {
		c.File(filePath)
		return
	}

	signedURL, err := storage.SignedURL(c.Request.Context(), store, key, 15*time.Minute)
	if err != nil {
		c.JSON(404, gin.H{"error": "attachment file not found"})
		return
	}
	c.Redirect(http.StatusTemporaryRedirect, signedURL)
}

func UploadMessageVideoNote(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, services.ChatVideoNoteMaxRequestSize)

		file, err := c.FormFile("video_note")
		if err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				c.JSON(413, gin.H{"error": "video note is too large"})
				return
			}

			c.JSON(400, gin.H{"error": "video note is required"})
			return
		}

		if file.Size <= 0 {
			c.JSON(400, gin.H{"error": "video note is required"})
			return
		}
		if file.Size > services.ChatVideoNoteMaxSize {
			c.JSON(413, gin.H{"error": "video note is too large"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read video note"})
			return
		}
		defer src.Close()

		data, err := io.ReadAll(src)
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read video note"})
			return
		}
		if int64(len(data)) > services.ChatVideoNoteMaxSize {
			c.JSON(413, gin.H{"error": "video note is too large"})
			return
		}

		contentType, ext, err := services.ValidateChatVideoNoteUpload(data, file.Header.Get("Content-Type"))
		if err != nil {
			c.JSON(415, gin.H{"error": err.Error()})
			return
		}

		durationSeconds, hasDuration := videoNoteDurationSecondsFromForm(c)
		if !hasDuration {
			c.JSON(400, gin.H{"error": "video note duration is required"})
			return
		}
		durationSeconds, err = services.ValidateChatVideoNoteDurationSeconds(durationSeconds)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		key, err := storage.NewObjectKey(fmt.Sprintf("video-notes/user_%d", userID), ext)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create video note filename"})
			return
		}
		filename := filepath.Base(key)

		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		if err := store.Upload(c.Request.Context(), key, bytes.NewReader(data), contentType); err != nil {
			c.JSON(500, gin.H{"error": "failed to save video note"})
			return
		}
		services.RememberChatUploadOwner(filename, userID)

		c.JSON(201, services.MessageAttachmentInput{
			AttachmentID:    strings.TrimSuffix(filename, filepath.Ext(filename)),
			FileURL:         services.PrivateUploadURL(filename),
			FileType:        "video_note",
			Duration:        durationSeconds,
			DurationSeconds: durationSeconds,
			Size:            int64(len(data)),
		})
	}
}
