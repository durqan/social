package services

import (
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tester/internal/cache"
	"tester/internal/models"

	_ "golang.org/x/image/webp"
)

const (
	ChatImageMaxSize        = 10 << 20 // 10 MB
	ChatImageMaxRequestSize = ChatImageMaxSize + 1<<20
	chatImageMaxCount       = 5
	chatUploadURLPrefix     = "/api/messages/uploads/"
	chatAttachmentURLPrefix = "/api/messages/attachments/"
	legacyChatUploadPrefix  = "/uploads/chat/"
	chatUploadOwnerTTL      = 24 * time.Hour
)

type MessageAttachmentInput struct {
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

func ChatImageExtension(contentType string) (string, bool) {
	ext, ok := allowedChatImageTypes[contentType]
	return ext, ok
}

func NormalizeMessageAttachments(input []MessageAttachmentInput, userID uint) ([]models.MessageAttachment, error) {
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
		if !ChatUploadOwnedBy(filename, userID) {
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

func PrivateAttachmentURL(attachmentID uint) string {
	return fmt.Sprintf("%s%d", chatAttachmentURLPrefix, attachmentID)
}

func PrivateUploadURL(filename string) string {
	return chatUploadURLPrefix + filename
}

func RememberChatUploadOwner(filename string, userID uint) {
	if cache.Redis == nil || filename == "" {
		return
	}
	_ = cache.Redis.Client.Set(cache.Redis.Ctx, chatUploadOwnerKey(filename), strconv.FormatUint(uint64(userID), 10), chatUploadOwnerTTL).Err()
}

func ChatUploadOwnedBy(filename string, userID uint) bool {
	if filename == "" || filename != filepath.Base(filename) {
		return false
	}
	if strings.HasPrefix(filename, fmt.Sprintf("%d_", userID)) {
		return true
	}
	if cache.Redis == nil {
		return false
	}
	value, err := cache.Redis.Client.Get(cache.Redis.Ctx, chatUploadOwnerKey(filename)).Result()
	if err != nil {
		return false
	}
	ownerID, err := strconv.ParseUint(value, 10, 32)
	return err == nil && uint(ownerID) == userID
}

func chatUploadOwnerKey(filename string) string {
	return "upload:chat:" + filename
}

func WithPrivateAttachmentURLs(message models.Message) models.Message {
	for i := range message.Attachments {
		message.Attachments[i].FileURL = PrivateAttachmentURL(message.Attachments[i].ID)
	}
	return message
}

func WithPrivateAttachmentURLsForMessages(messages []models.Message) []models.Message {
	for i := range messages {
		messages[i] = WithPrivateAttachmentURLs(messages[i])
	}
	return messages
}

func ChatUploadPath(filename string) (string, bool) {
	if filename == "" || filename != filepath.Base(filename) {
		return "", false
	}
	return filepath.Join("uploads", "chat", filename), true
}
