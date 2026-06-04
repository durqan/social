package services

import (
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"mime"
	"os"
	"path/filepath"
	"regexp"
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
	ChatVoiceMaxSize        = 12 << 20 // 12 MB
	ChatVoiceMaxRequestSize = ChatVoiceMaxSize + 1<<20
	ChatVoiceMaxDuration    = 5 * 60
	chatVoiceMaxCount       = 1
	chatUploadURLPrefix     = "/api/messages/uploads/"
	chatAttachmentURLPrefix = "/api/messages/attachments/"
	legacyChatUploadPrefix  = "/uploads/chat/"
	chatUploadOwnerTTL      = 24 * time.Hour
)

type MessageAttachmentInput struct {
	ID              uint   `json:"id,omitempty"`
	AttachmentID    string `json:"attachment_id,omitempty"`
	MessageID       uint   `json:"message_id,omitempty"`
	FileURL         string `json:"file_url"`
	FileType        string `json:"file_type"`
	Width           int    `json:"width,omitempty"`
	Height          int    `json:"height,omitempty"`
	Duration        int    `json:"duration,omitempty"`
	DurationSeconds int    `json:"duration_seconds,omitempty"`
	Size            int64  `json:"size"`
}

var allowedChatImageTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

var allowedChatVoiceTypes = map[string]struct {
	extension   string
	contentType string
}{
	"audio/webm":      {extension: ".webm", contentType: "audio/webm"},
	"audio/ogg":       {extension: ".ogg", contentType: "audio/ogg"},
	"application/ogg": {extension: ".ogg", contentType: "audio/ogg"},
}

var generatedUploadFilenamePattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|webm|ogg)$`)

func ChatImageExtension(contentType string) (string, bool) {
	ext, ok := allowedChatImageTypes[contentType]
	return ext, ok
}

func ChatVoiceExtension(contentType string) (string, string, bool) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(contentType))
	}

	format, ok := allowedChatVoiceTypes[mediaType]
	if !ok {
		return "", "", false
	}
	return format.extension, format.contentType, true
}

func ValidateChatVoiceUpload(data []byte, declaredContentType string) (string, string, error) {
	declaredExtension, canonicalContentType, ok := ChatVoiceExtension(declaredContentType)
	if !ok {
		return "", "", errors.New("voice must be webm or ogg")
	}

	actualExtension, ok := chatVoiceExtensionFromMagic(data)
	if !ok {
		return "", "", errors.New("invalid voice")
	}
	if actualExtension != declaredExtension {
		return "", "", errors.New("voice content does not match content type")
	}

	return canonicalContentType, declaredExtension, nil
}

func ParseChatVoiceDurationSeconds(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}

	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil || seconds <= 0 {
		return 0, false
	}

	return int(math.Ceil(seconds)), true
}

func ValidateChatVoiceDurationSeconds(duration int) (int, error) {
	if duration <= 0 {
		return 0, errors.New("voice duration is required")
	}
	if duration > ChatVoiceMaxDuration {
		return 0, errors.New("voice is too long")
	}
	return duration, nil
}

func NormalizeMessageAttachments(input []MessageAttachmentInput, userID uint) ([]models.MessageAttachment, error) {
	imageCount := 0
	voiceCount := 0
	for _, item := range input {
		switch item.FileType {
		case "image":
			imageCount++
		case "voice":
			voiceCount++
		default:
			return nil, errors.New("unsupported attachment type")
		}
	}
	if imageCount > chatImageMaxCount {
		return nil, errors.New("too many images")
	}
	if voiceCount > chatVoiceMaxCount {
		return nil, errors.New("only one voice attachment is supported")
	}
	if imageCount > 0 && voiceCount > 0 {
		return nil, errors.New("cannot mix image and voice attachments")
	}

	attachments := make([]models.MessageAttachment, 0, len(input))

	for _, item := range input {
		switch item.FileType {
		case "image":
			attachment, err := normalizeImageAttachment(item, userID)
			if err != nil {
				return nil, err
			}
			attachments = append(attachments, attachment)
		case "voice":
			attachment, err := normalizeVoiceAttachment(item, userID)
			if err != nil {
				return nil, err
			}
			attachments = append(attachments, attachment)
		}
	}

	return attachments, nil
}

func normalizeImageAttachment(item MessageAttachmentInput, userID uint) (models.MessageAttachment, error) {
	if !strings.HasPrefix(item.FileURL, chatUploadURLPrefix) && !strings.HasPrefix(item.FileURL, legacyChatUploadPrefix) {
		return models.MessageAttachment{}, errors.New("invalid image url")
	}

	fileURL := filepath.ToSlash(filepath.Clean(item.FileURL))
	if !strings.HasPrefix(fileURL, chatUploadURLPrefix) && !strings.HasPrefix(fileURL, legacyChatUploadPrefix) {
		return models.MessageAttachment{}, errors.New("invalid image url")
	}

	filename := filepath.Base(fileURL)
	if !ChatUploadOwnedBy(filename, userID) {
		return models.MessageAttachment{}, errors.New("invalid image owner")
	}

	key := ChatUploadKey(filename, userID)
	storedKey, width, height, size, err := attachmentStorageMetadata(key, item)
	if err != nil {
		return models.MessageAttachment{}, err
	}

	return models.MessageAttachment{
		FileURL:  storedKey,
		FileType: "image",
		Width:    &width,
		Height:   &height,
		Size:     size,
	}, nil
}

func normalizeVoiceAttachment(item MessageAttachmentInput, userID uint) (models.MessageAttachment, error) {
	if !strings.HasPrefix(item.FileURL, chatUploadURLPrefix) {
		return models.MessageAttachment{}, errors.New("invalid voice url")
	}

	fileURL := filepath.ToSlash(filepath.Clean(item.FileURL))
	if !strings.HasPrefix(fileURL, chatUploadURLPrefix) {
		return models.MessageAttachment{}, errors.New("invalid voice url")
	}

	filename := filepath.Base(fileURL)
	if !ChatUploadOwnedBy(filename, userID) {
		return models.MessageAttachment{}, errors.New("invalid voice owner")
	}

	key := ChatUploadKey(filename, userID)
	storedKey, size, durationSeconds, err := voiceAttachmentStorageMetadata(key, item)
	if err != nil {
		return models.MessageAttachment{}, err
	}

	return models.MessageAttachment{
		FileURL:         storedKey,
		FileType:        "voice",
		DurationSeconds: &durationSeconds,
		Size:            size,
	}, nil
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
		return generatedUploadFilenamePattern.MatchString(filename)
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
	if chatVoiceExtensionFromFilename(filename) != "" {
		return filepath.ToSlash(filepath.Join("voice", fmt.Sprintf("user_%d", userID), filename))
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

func voiceAttachmentStorageMetadata(key string, item MessageAttachmentInput) (string, int64, int, error) {
	store, err := storage.Default()
	if err != nil {
		return "", 0, 0, errors.New("failed to load storage")
	}

	cleanKey, err := storage.CleanKey(key)
	if err != nil {
		return "", 0, 0, errors.New("invalid voice url")
	}

	if filePath, ok := storage.LocalPath(store, cleanKey); ok {
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return "", 0, 0, errors.New("voice not found")
		}
		if info.Size() <= 0 || info.Size() > ChatVoiceMaxSize {
			return "", 0, 0, errors.New("voice is too large")
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", 0, 0, errors.New("failed to read voice")
		}
		if !chatVoiceMagicMatchesExtension(data, chatVoiceExtensionFromFilename(cleanKey)) {
			return "", 0, 0, errors.New("invalid voice")
		}

		duration, err := ValidateChatVoiceDurationSeconds(item.voiceDurationSeconds())
		if err != nil {
			return "", 0, 0, err
		}

		return cleanKey, info.Size(), duration, nil
	}

	if item.Size <= 0 || item.Size > ChatVoiceMaxSize {
		return "", 0, 0, errors.New("voice is too large")
	}
	duration, err := ValidateChatVoiceDurationSeconds(item.voiceDurationSeconds())
	if err != nil {
		return "", 0, 0, err
	}

	return cleanKey, item.Size, duration, nil
}

func (item MessageAttachmentInput) voiceDurationSeconds() int {
	if item.DurationSeconds > 0 {
		return item.DurationSeconds
	}
	return item.Duration
}

func chatVoiceExtensionFromFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".webm":
		return ".webm"
	case ".ogg":
		return ".ogg"
	default:
		return ""
	}
}

func chatVoiceExtensionFromMagic(data []byte) (string, bool) {
	if len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3 {
		return ".webm", true
	}
	if len(data) >= 4 && string(data[:4]) == "OggS" {
		return ".ogg", true
	}
	return "", false
}

func chatVoiceMagicMatchesExtension(data []byte, extension string) bool {
	actualExtension, ok := chatVoiceExtensionFromMagic(data)
	return ok && actualExtension == extension
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
