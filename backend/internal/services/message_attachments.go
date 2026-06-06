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
	ChatImageMaxSize            = 10 << 20 // 10 MB
	ChatImageMaxRequestSize     = ChatImageMaxSize + 1<<20
	chatImageMaxCount           = 5
	ChatVoiceMaxSize            = 12 << 20 // 12 MB
	ChatVoiceMaxRequestSize     = ChatVoiceMaxSize + 1<<20
	ChatVoiceMaxDuration        = 5 * 60
	chatVoiceMaxCount           = 1
	ChatVideoNoteMaxSize        = 25 << 20 // 25 MB
	ChatVideoNoteMaxRequestSize = ChatVideoNoteMaxSize + 1<<20
	ChatVideoNoteMaxDuration    = 60
	chatVideoNoteMaxCount       = 1
	encryptedAttachmentOverhead = 64 << 10
	MaxEncryptedAttachmentField = 64 << 10
	chatUploadURLPrefix         = "/api/messages/uploads/"
	chatAttachmentURLPrefix     = "/api/messages/attachments/"
	legacyChatUploadPrefix      = "/uploads/chat/"
	chatUploadOwnerTTL          = 24 * time.Hour
)

type MessageAttachmentInput struct {
	ID                uint   `json:"id,omitempty"`
	AttachmentID      string `json:"attachment_id,omitempty"`
	MessageID         uint   `json:"message_id,omitempty"`
	FileURL           string `json:"file_url"`
	FileType          string `json:"file_type"`
	Width             int    `json:"width,omitempty"`
	Height            int    `json:"height,omitempty"`
	Duration          int    `json:"duration,omitempty"`
	DurationSeconds   int    `json:"duration_seconds,omitempty"`
	Size              int64  `json:"size"`
	EncryptionVersion int    `json:"encryption_version,omitempty"`
	EncryptedFileKey  string `json:"encrypted_file_key,omitempty"`
	FileNonce         string `json:"file_nonce,omitempty"`
	EncryptedMetadata string `json:"encrypted_metadata,omitempty"`
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

var allowedChatVideoNoteTypes = map[string]struct {
	extension   string
	contentType string
}{
	"video/webm": {extension: ".webm", contentType: "video/webm"},
	"video/mp4":  {extension: ".mp4", contentType: "video/mp4"},
}

var generatedUploadFilenamePattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|webm|ogg|mp4|bin)$`)

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

func ChatVideoNoteExtension(contentType string) (string, string, bool) {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(contentType))
	}

	format, ok := allowedChatVideoNoteTypes[mediaType]
	if !ok {
		return "", "", false
	}
	return format.extension, format.contentType, true
}

func ValidateChatVideoNoteUpload(data []byte, declaredContentType string) (string, string, error) {
	declaredExtension, canonicalContentType, ok := ChatVideoNoteExtension(declaredContentType)
	if !ok {
		return "", "", errors.New("video note must be webm or mp4")
	}

	actualExtension, ok := chatVideoNoteExtensionFromMagic(data)
	if !ok {
		return "", "", errors.New("invalid video note")
	}
	if actualExtension != declaredExtension {
		return "", "", errors.New("video note content does not match content type")
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
	if duration < 1 {
		return 0, errors.New("voice duration must be at least 1 second")
	}
	if duration > ChatVoiceMaxDuration {
		return 0, errors.New("voice is too long")
	}
	return duration, nil
}

func ParseChatVideoNoteDurationSeconds(value string) (int, bool) {
	return parseChatMediaDurationSeconds(value)
}

func ValidateChatVideoNoteDurationSeconds(duration int) (int, error) {
	if duration < 1 {
		return 0, errors.New("video note duration must be at least 1 second")
	}
	if duration > ChatVideoNoteMaxDuration {
		return 0, errors.New("video note is too long")
	}
	return duration, nil
}

func NormalizeMessageAttachments(input []MessageAttachmentInput, userID uint) ([]models.MessageAttachment, error) {
	imageCount := 0
	voiceCount := 0
	videoNoteCount := 0
	for _, item := range input {
		switch item.FileType {
		case "image":
			imageCount++
		case "voice":
			voiceCount++
		case "video_note":
			videoNoteCount++
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
	if videoNoteCount > chatVideoNoteMaxCount {
		return nil, errors.New("only one video note attachment is supported")
	}
	if imageCount > 0 && voiceCount > 0 {
		return nil, errors.New("cannot mix image and voice attachments")
	}
	if videoNoteCount > 0 && (imageCount > 0 || voiceCount > 0) {
		return nil, errors.New("cannot mix video note with other attachments")
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
		case "video_note":
			attachment, err := normalizeVideoNoteAttachment(item, userID)
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
	if item.encryptionEnabled() {
		storedKey, width, height, size, err := encryptedImageAttachmentStorageMetadata(key, item)
		if err != nil {
			return models.MessageAttachment{}, err
		}

		return models.MessageAttachment{
			FileURL:           storedKey,
			FileType:          "image",
			Width:             &width,
			Height:            &height,
			Size:              size,
			EncryptionVersion: item.EncryptionVersion,
			EncryptedFileKey:  strings.TrimSpace(item.EncryptedFileKey),
			FileNonce:         strings.TrimSpace(item.FileNonce),
			EncryptedMetadata: strings.TrimSpace(item.EncryptedMetadata),
		}, nil
	}

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
	if item.encryptionEnabled() {
		storedKey, size, durationSeconds, err := encryptedMediaAttachmentStorageMetadata(key, item, ChatVoiceMaxSize+encryptedAttachmentOverhead, "voice")
		if err != nil {
			return models.MessageAttachment{}, err
		}

		return models.MessageAttachment{
			FileURL:           storedKey,
			FileType:          "voice",
			DurationSeconds:   &durationSeconds,
			Size:              size,
			EncryptionVersion: item.EncryptionVersion,
			EncryptedFileKey:  strings.TrimSpace(item.EncryptedFileKey),
			FileNonce:         strings.TrimSpace(item.FileNonce),
			EncryptedMetadata: strings.TrimSpace(item.EncryptedMetadata),
		}, nil
	}

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

func normalizeVideoNoteAttachment(item MessageAttachmentInput, userID uint) (models.MessageAttachment, error) {
	if !strings.HasPrefix(item.FileURL, chatUploadURLPrefix) {
		return models.MessageAttachment{}, errors.New("invalid video note url")
	}

	fileURL := filepath.ToSlash(filepath.Clean(item.FileURL))
	if !strings.HasPrefix(fileURL, chatUploadURLPrefix) {
		return models.MessageAttachment{}, errors.New("invalid video note url")
	}

	filename := filepath.Base(fileURL)
	if !ChatUploadOwnedBy(filename, userID) {
		return models.MessageAttachment{}, errors.New("invalid video note owner")
	}

	key := VideoNoteUploadKey(filename, userID)
	if item.encryptionEnabled() {
		storedKey, size, durationSeconds, err := encryptedMediaAttachmentStorageMetadata(key, item, ChatVideoNoteMaxSize+encryptedAttachmentOverhead, "video note")
		if err != nil {
			return models.MessageAttachment{}, err
		}

		return models.MessageAttachment{
			FileURL:           storedKey,
			FileType:          "video_note",
			DurationSeconds:   &durationSeconds,
			Size:              size,
			EncryptionVersion: item.EncryptionVersion,
			EncryptedFileKey:  strings.TrimSpace(item.EncryptedFileKey),
			FileNonce:         strings.TrimSpace(item.FileNonce),
			EncryptedMetadata: strings.TrimSpace(item.EncryptedMetadata),
		}, nil
	}

	storedKey, size, durationSeconds, err := videoNoteAttachmentStorageMetadata(key, item)
	if err != nil {
		return models.MessageAttachment{}, err
	}

	return models.MessageAttachment{
		FileURL:         storedKey,
		FileType:        "video_note",
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
	if chatEncryptedExtensionFromFilename(filename) != "" {
		return EncryptedChatUploadKey(filename, userID)
	}
	if strings.HasPrefix(filename, fmt.Sprintf("%d_", userID)) {
		return filepath.ToSlash(filepath.Join("chat", filename))
	}
	if chatVoiceExtensionFromFilename(filename) != "" {
		return filepath.ToSlash(filepath.Join("voice", fmt.Sprintf("user_%d", userID), filename))
	}
	return filepath.ToSlash(filepath.Join("messages", fmt.Sprintf("user_%d", userID), filename))
}

func VideoNoteUploadKey(filename string, userID uint) string {
	if chatEncryptedExtensionFromFilename(filename) != "" {
		return EncryptedChatUploadKey(filename, userID)
	}
	return filepath.ToSlash(filepath.Join("video-notes", fmt.Sprintf("user_%d", userID), filename))
}

func EncryptedChatUploadKey(filename string, userID uint) string {
	return filepath.ToSlash(filepath.Join("encrypted", fmt.Sprintf("user_%d", userID), filename))
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

func (item MessageAttachmentInput) encryptionEnabled() bool {
	return item.EncryptionVersion > 0 ||
		strings.TrimSpace(item.EncryptedFileKey) != "" ||
		strings.TrimSpace(item.FileNonce) != "" ||
		strings.TrimSpace(item.EncryptedMetadata) != ""
}

func validateEncryptedAttachmentFields(item MessageAttachmentInput) error {
	if item.EncryptionVersion != 1 {
		return errors.New("invalid encrypted attachment metadata")
	}
	if strings.TrimSpace(item.EncryptedFileKey) == "" ||
		strings.TrimSpace(item.FileNonce) == "" ||
		strings.TrimSpace(item.EncryptedMetadata) == "" {
		return errors.New("invalid encrypted attachment metadata")
	}
	if len(item.EncryptedFileKey) > MaxEncryptedAttachmentField ||
		len(item.FileNonce) > 256 ||
		len(item.EncryptedMetadata) > MaxEncryptedAttachmentField {
		return errors.New("encrypted attachment metadata is too large")
	}
	return nil
}

func encryptedImageAttachmentStorageMetadata(key string, item MessageAttachmentInput) (string, int, int, int64, error) {
	if err := validateEncryptedAttachmentFields(item); err != nil {
		return "", 0, 0, 0, err
	}
	if item.Width <= 0 || item.Height <= 0 {
		return "", 0, 0, 0, errors.New("invalid encrypted attachment metadata")
	}

	storedKey, size, err := encryptedAttachmentStorageMetadata(key, item, ChatImageMaxSize+encryptedAttachmentOverhead, "image")
	if err != nil {
		return "", 0, 0, 0, err
	}
	return storedKey, item.Width, item.Height, size, nil
}

func encryptedMediaAttachmentStorageMetadata(key string, item MessageAttachmentInput, maxSize int64, label string) (string, int64, int, error) {
	if err := validateEncryptedAttachmentFields(item); err != nil {
		return "", 0, 0, err
	}
	duration, err := ValidateChatVoiceDurationSeconds(item.mediaDurationSeconds())
	if label == "video note" {
		duration, err = ValidateChatVideoNoteDurationSeconds(item.mediaDurationSeconds())
	}
	if err != nil {
		return "", 0, 0, err
	}

	storedKey, size, err := encryptedAttachmentStorageMetadata(key, item, maxSize, label)
	if err != nil {
		return "", 0, 0, err
	}
	return storedKey, size, duration, nil
}

func encryptedAttachmentStorageMetadata(key string, item MessageAttachmentInput, maxSize int64, label string) (string, int64, error) {
	store, err := storage.Default()
	if err != nil {
		return "", 0, errors.New("failed to load storage")
	}

	cleanKey, err := storage.CleanKey(key)
	if err != nil {
		return "", 0, fmt.Errorf("invalid %s url", label)
	}

	if filePath, ok := storage.LocalPath(store, cleanKey); ok {
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return "", 0, fmt.Errorf("%s not found", label)
		}
		if info.Size() <= 0 || info.Size() > maxSize {
			return "", 0, fmt.Errorf("%s is too large", label)
		}
		return cleanKey, info.Size(), nil
	}

	if item.Size <= 0 || item.Size > maxSize {
		return "", 0, fmt.Errorf("%s is too large", label)
	}
	return cleanKey, item.Size, nil
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

func videoNoteAttachmentStorageMetadata(key string, item MessageAttachmentInput) (string, int64, int, error) {
	store, err := storage.Default()
	if err != nil {
		return "", 0, 0, errors.New("failed to load storage")
	}

	cleanKey, err := storage.CleanKey(key)
	if err != nil {
		return "", 0, 0, errors.New("invalid video note url")
	}

	if filePath, ok := storage.LocalPath(store, cleanKey); ok {
		info, err := os.Stat(filePath)
		if err != nil || info.IsDir() {
			return "", 0, 0, errors.New("video note not found")
		}
		if info.Size() <= 0 || info.Size() > ChatVideoNoteMaxSize {
			return "", 0, 0, errors.New("video note is too large")
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", 0, 0, errors.New("failed to read video note")
		}
		if !chatVideoNoteMagicMatchesExtension(data, chatVideoNoteExtensionFromFilename(cleanKey)) {
			return "", 0, 0, errors.New("invalid video note")
		}

		duration, err := ValidateChatVideoNoteDurationSeconds(item.mediaDurationSeconds())
		if err != nil {
			return "", 0, 0, err
		}

		return cleanKey, info.Size(), duration, nil
	}

	if item.Size <= 0 || item.Size > ChatVideoNoteMaxSize {
		return "", 0, 0, errors.New("video note is too large")
	}
	duration, err := ValidateChatVideoNoteDurationSeconds(item.mediaDurationSeconds())
	if err != nil {
		return "", 0, 0, err
	}

	return cleanKey, item.Size, duration, nil
}

func (item MessageAttachmentInput) voiceDurationSeconds() int {
	return item.mediaDurationSeconds()
}

func (item MessageAttachmentInput) mediaDurationSeconds() int {
	if item.DurationSeconds > 0 {
		return item.DurationSeconds
	}
	return item.Duration
}

func parseChatMediaDurationSeconds(value string) (int, bool) {
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

func chatVideoNoteExtensionFromFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".webm":
		return ".webm"
	case ".mp4":
		return ".mp4"
	default:
		return ""
	}
}

func chatEncryptedExtensionFromFilename(filename string) string {
	if strings.EqualFold(filepath.Ext(filename), ".bin") {
		return ".bin"
	}
	return ""
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

func chatVideoNoteExtensionFromMagic(data []byte) (string, bool) {
	if len(data) >= 4 && data[0] == 0x1a && data[1] == 0x45 && data[2] == 0xdf && data[3] == 0xa3 {
		return ".webm", true
	}
	if len(data) >= 8 && string(data[4:8]) == "ftyp" {
		return ".mp4", true
	}
	return "", false
}

func chatVideoNoteMagicMatchesExtension(data []byte, extension string) bool {
	actualExtension, ok := chatVideoNoteExtensionFromMagic(data)
	return ok && actualExtension == extension
}

func ContentTypeForKey(key string) string {
	cleanKey := strings.ToLower(filepath.ToSlash(key))
	switch filepath.Ext(cleanKey) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	case ".ogg":
		return "audio/ogg"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		if strings.HasPrefix(cleanKey, "voice/") {
			return "audio/webm"
		}
		return "video/webm"
	case ".bin":
		return "application/octet-stream"
	default:
		return ""
	}
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
