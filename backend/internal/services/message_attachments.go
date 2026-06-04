package services

import (
	"context"
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
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/storage"

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

		key := ChatUploadKey(filename, userID)
		storedKey, width, height, size, err := attachmentStorageMetadata(key, item)
		if err != nil {
			return nil, err
		}

		attachments = append(attachments, models.MessageAttachment{
			FileURL:  storedKey,
			FileType: "image",
			Width:    &width,
			Height:   &height,
			Size:     size,
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
	message.From = dto.WithResolvedAvatar(message.From)
	message.To = dto.WithResolvedAvatar(message.To)
	if message.ForwardedFromUser != nil {
		user := dto.WithResolvedAvatar(*message.ForwardedFromUser)
		message.ForwardedFromUser = &user
	}
	for i := range message.Attachments {
		message.Attachments[i].FileURL = PrivateAttachmentURL(message.Attachments[i].ID)
	}
	if message.ReplyToMessage != nil {
		reply := WithPrivateAttachmentURLs(*message.ReplyToMessage)
		reply.ReplyToMessage = nil
		reply.ForwardedFromMessage = nil
		message.ReplyToMessage = &reply
	}
	if message.ForwardedFromMessage != nil {
		forwarded := WithPrivateAttachmentURLs(*message.ForwardedFromMessage)
		forwarded.ReplyToMessage = nil
		forwarded.ForwardedFromMessage = nil
		message.ForwardedFromMessage = &forwarded
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

func ChatUploadKey(filename string, userID uint) string {
	if strings.HasPrefix(filename, fmt.Sprintf("%d_", userID)) {
		return filepath.ToSlash(filepath.Join("chat", filename))
	}
	return filepath.ToSlash(filepath.Join("messages", fmt.Sprintf("user_%d", userID), filename))
}

func ChatUploadKeyFromFilename(filename string, userID uint) (string, bool) {
	if filename == "" || filename != filepath.Base(filename) {
		return "", false
	}
	return ChatUploadKey(filename, userID), true
}

func AttachmentObjectKey(storedValue string) (string, bool) {
	return storage.KeyFromStoredValue(storedValue)
}

func attachmentStorageMetadata(key string, item MessageAttachmentInput) (string, int, int, int64, error) {
	store, err := storage.Default()
	if err != nil {
		return "", 0, 0, 0, errors.New("failed to load storage")
	}

	cleanKey, err := storage.CleanKey(key)
	if err != nil {
		return "", 0, 0, 0, errors.New("invalid image url")
	}

	if filePath, ok := storage.LocalPath(store, cleanKey); ok {
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return "", 0, 0, 0, errors.New("image not found")
		}

		file, err := os.Open(filePath)
		if err != nil {
			return "", 0, 0, 0, errors.New("failed to read image")
		}

		cfg, _, err := image.DecodeConfig(file)
		_ = file.Close()
		if err != nil {
			return "", 0, 0, 0, errors.New("invalid image")
		}

		return cleanKey, cfg.Width, cfg.Height, info.Size(), nil
	}

	if item.Width <= 0 || item.Height <= 0 || item.Size <= 0 || item.Size > ChatImageMaxSize {
		return "", 0, 0, 0, errors.New("invalid image")
	}

	return cleanKey, item.Width, item.Height, item.Size, nil
}

func DeleteObjectKeys(ctx context.Context, values []string) {
	store, err := storage.Default()
	if err != nil {
		return
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		key, ok := storage.KeyFromStoredValue(value)
		if !ok {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		_ = store.Delete(ctx, key)
	}
}
