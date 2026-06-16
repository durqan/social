package handlers

import (
	"errors"
	"fmt"
	"image"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tester/internal/models"
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

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, services.ChatAttachmentMaxRequestSize)

		file, fieldName, err := messageUploadFileFromForm(c)
		if err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				c.JSON(413, gin.H{"error": "file is too large"})
				return
			}

			c.JSON(400, gin.H{"error": "file is required"})
			return
		}

		encryptedInput, encrypted, err := encryptedAttachmentInputFromForm(c)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		requestedFileType := strings.TrimSpace(c.PostForm("file_type"))
		if requestedFileType == "" && fieldName == "image" {
			requestedFileType = "image"
		}
		if encrypted {
			if file.Size <= 0 {
				c.JSON(400, gin.H{"error": "file is required"})
				return
			}
			fileType, ok := services.NormalizeChatAttachmentFileType(requestedFileType)
			if !ok {
				c.JSON(400, gin.H{"error": "unsupported attachment type"})
				return
			}
			maxSize, _ := services.ChatAttachmentMaxSizeForType(fileType)
			if file.Size > maxSize+services.MaxEncryptedAttachmentField {
				c.JSON(413, gin.H{"error": services.ChatAttachmentLabel(fileType) + " is too large"})
				return
			}

			var width, height int
			if fileType == "image" {
				width, height, err = imageDimensionsFromForm(c)
				if err != nil {
					c.JSON(400, gin.H{"error": err.Error()})
					return
				}
			}

			attachment, ok := saveEncryptedMessageUpload(c, userID, file, services.ChatAttachmentLabel(fileType), fileType)
			if !ok {
				return
			}
			if fileType == "image" {
				attachment.Width = width
				attachment.Height = height
			}
			attachment.Size = file.Size
			attachment.EncryptionVersion = encryptedInput.EncryptionVersion
			attachment.EncryptedFileKey = encryptedInput.EncryptedFileKey
			attachment.FileNonce = encryptedInput.FileNonce
			attachment.EncryptedMetadata = encryptedInput.EncryptedMetadata
			c.JSON(201, attachment)
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read file"})
			return
		}
		defer src.Close()

		info, err := services.ValidateChatAttachmentUpload(src, file.Filename, file.Header.Get("Content-Type"), requestedFileType, file.Size)
		if err != nil {
			c.JSON(messageUploadValidationStatus(err), gin.H{"error": err.Error()})
			return
		}

		var width, height int

		if info.FileType == "image" {
			if _, err := src.Seek(0, 0); err != nil {
				c.JSON(400, gin.H{"error": "failed to read image"})
				return
			}
			cfg, _, err := image.DecodeConfig(src)
			if err != nil {
				c.JSON(415, gin.H{"error": "invalid image"})
				return
			}
			width = cfg.Width
			height = cfg.Height
		}

		if _, err := src.Seek(0, 0); err != nil {
			c.JSON(400, gin.H{"error": "failed to read file"})
			return
		}

		key, err := storage.NewObjectKey(fmt.Sprintf("messages/user_%d", userID), info.Extension)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create file filename"})
			return
		}
		filename := filepath.Base(key)

		store, err := storage.Default()
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
			return
		}

		if err := store.Upload(c.Request.Context(), key, src, info.ContentType); err != nil {
			c.JSON(500, gin.H{"error": "failed to save file"})
			return
		}
		services.RememberChatUploadOwner(filename, userID)

		c.JSON(201, services.MessageAttachmentInput{
			FileURL:          services.PrivateUploadURL(filename),
			FileType:         info.FileType,
			Width:            width,
			Height:           height,
			Size:             file.Size,
			OriginalFilename: info.OriginalFilename,
			ContentType:      info.ContentType,
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

		encryptedInput, encrypted, err := encryptedAttachmentInputFromForm(c)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		maxSize := int64(services.ChatVoiceMaxSize)
		if encrypted {
			maxSize += services.MaxEncryptedAttachmentField
		}
		if file.Size > maxSize {
			c.JSON(413, gin.H{"error": "voice is too large"})
			return
		}
		if encrypted {
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

			attachment, ok := saveEncryptedMessageUpload(c, userID, file, "voice", "voice")
			if !ok {
				return
			}
			attachment.AttachmentID = strings.TrimSuffix(filepath.Base(attachment.FileURL), filepath.Ext(filepath.Base(attachment.FileURL)))
			attachment.Duration = durationSeconds
			attachment.DurationSeconds = durationSeconds
			attachment.Size = file.Size
			attachment.EncryptionVersion = encryptedInput.EncryptionVersion
			attachment.EncryptedFileKey = encryptedInput.EncryptedFileKey
			attachment.FileNonce = encryptedInput.FileNonce
			attachment.EncryptedMetadata = encryptedInput.EncryptedMetadata
			c.JSON(201, attachment)
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read voice"})
			return
		}
		defer src.Close()

		header, err := readUploadHeader(src)
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read voice"})
			return
		}
		if file.Size > services.ChatVoiceMaxSize {
			c.JSON(413, gin.H{"error": "voice is too large"})
			return
		}

		contentType, ext, err := services.ValidateChatVoiceUploadMagic(header, file.Header.Get("Content-Type"))
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

		if err := store.Upload(c.Request.Context(), key, src, contentType); err != nil {
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
			Size:            file.Size,
		})
	}
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

		encryptedInput, encrypted, err := encryptedAttachmentInputFromForm(c)
		if err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		maxSize := int64(services.ChatVideoNoteMaxSize)
		if encrypted {
			maxSize += services.MaxEncryptedAttachmentField
		}
		if file.Size > maxSize {
			c.JSON(413, gin.H{"error": "video note is too large"})
			return
		}
		if encrypted {
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

			attachment, ok := saveEncryptedMessageUpload(c, userID, file, "video note", "video_note")
			if !ok {
				return
			}
			attachment.AttachmentID = strings.TrimSuffix(filepath.Base(attachment.FileURL), filepath.Ext(filepath.Base(attachment.FileURL)))
			attachment.Duration = durationSeconds
			attachment.DurationSeconds = durationSeconds
			attachment.Size = file.Size
			attachment.EncryptionVersion = encryptedInput.EncryptionVersion
			attachment.EncryptedFileKey = encryptedInput.EncryptedFileKey
			attachment.FileNonce = encryptedInput.FileNonce
			attachment.EncryptedMetadata = encryptedInput.EncryptedMetadata
			c.JSON(201, attachment)
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read video note"})
			return
		}
		defer src.Close()

		header, err := readUploadHeader(src)
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read video note"})
			return
		}
		if file.Size > services.ChatVideoNoteMaxSize {
			c.JSON(413, gin.H{"error": "video note is too large"})
			return
		}

		contentType, ext, err := services.ValidateChatVideoNoteUploadMagic(header, file.Header.Get("Content-Type"))
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

		if err := store.Upload(c.Request.Context(), key, src, contentType); err != nil {
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
			Size:            file.Size,
		})
	}
}

func readUploadHeader(src multipart.File) ([]byte, error) {
	header := make([]byte, 512)
	n, err := src.Read(header)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if _, err := src.Seek(0, 0); err != nil {
		return nil, err
	}
	return header[:n], nil
}

func messageUploadFileFromForm(c *gin.Context) (*multipart.FileHeader, string, error) {
	for _, fieldName := range []string{"attachment", "image"} {
		file, err := c.FormFile(fieldName)
		if err == nil {
			return file, fieldName, nil
		}
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return nil, "", err
		}
	}
	return nil, "", http.ErrMissingFile
}

func messageUploadValidationStatus(err error) int {
	message := err.Error()
	if strings.Contains(message, "too large") {
		return http.StatusRequestEntityTooLarge
	}
	if strings.Contains(message, "empty") || strings.Contains(message, "required") || strings.Contains(message, "failed to read") {
		return http.StatusBadRequest
	}
	return http.StatusUnsupportedMediaType
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

func encryptedAttachmentInputFromForm(c *gin.Context) (services.MessageAttachmentInput, bool, error) {
	versionValue := strings.TrimSpace(c.PostForm("encryption_version"))
	encryptedFileKey := strings.TrimSpace(c.PostForm("encrypted_file_key"))
	fileNonce := strings.TrimSpace(c.PostForm("file_nonce"))
	encryptedMetadata := strings.TrimSpace(c.PostForm("encrypted_metadata"))

	enabled := versionValue != "" || encryptedFileKey != "" || fileNonce != "" || encryptedMetadata != ""
	if !enabled {
		return services.MessageAttachmentInput{}, false, nil
	}

	version, err := strconv.Atoi(versionValue)
	if err != nil || version != 1 || encryptedFileKey == "" || fileNonce == "" || encryptedMetadata == "" {
		return services.MessageAttachmentInput{}, false, errors.New("invalid encrypted attachment metadata")
	}
	if len(encryptedFileKey) > services.MaxEncryptedAttachmentField ||
		len(fileNonce) > 256 ||
		len(encryptedMetadata) > services.MaxEncryptedAttachmentField {
		return services.MessageAttachmentInput{}, false, errors.New("encrypted attachment metadata is too large")
	}

	return services.MessageAttachmentInput{
		EncryptionVersion: version,
		EncryptedFileKey:  encryptedFileKey,
		FileNonce:         fileNonce,
		EncryptedMetadata: encryptedMetadata,
	}, true, nil
}

func imageDimensionsFromForm(c *gin.Context) (int, int, error) {
	width, err := positiveIntFromForm(c, "width")
	if err != nil {
		return 0, 0, errors.New("invalid encrypted attachment metadata")
	}
	height, err := positiveIntFromForm(c, "height")
	if err != nil {
		return 0, 0, errors.New("invalid encrypted attachment metadata")
	}
	return width, height, nil
}

func positiveIntFromForm(c *gin.Context, key string) (int, error) {
	value, err := strconv.Atoi(strings.TrimSpace(c.PostForm(key)))
	if err != nil || value <= 0 {
		return 0, errors.New("invalid form value")
	}
	return value, nil
}

func saveEncryptedMessageUpload(c *gin.Context, userID uint, file *multipart.FileHeader, errorLabel string, fileType string) (services.MessageAttachmentInput, bool) {
	src, err := file.Open()
	if err != nil {
		c.JSON(400, gin.H{"error": fmt.Sprintf("failed to read %s", errorLabel)})
		return services.MessageAttachmentInput{}, false
	}
	defer src.Close()

	key, err := storage.NewObjectKey(fmt.Sprintf("encrypted/user_%d", userID), ".bin")
	if err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("failed to create %s filename", errorLabel)})
		return services.MessageAttachmentInput{}, false
	}
	filename := filepath.Base(key)

	store, err := storage.Default()
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to prepare upload storage"})
		return services.MessageAttachmentInput{}, false
	}

	if err := store.Upload(c.Request.Context(), key, src, "application/octet-stream"); err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("failed to save %s", errorLabel)})
		return services.MessageAttachmentInput{}, false
	}
	services.RememberChatUploadOwner(filename, userID)

	return services.MessageAttachmentInput{
		FileURL:  services.PrivateUploadURL(filename),
		FileType: fileType,
		Size:     file.Size,
	}, true
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

		serveMessageAttachmentObject(c, store, key, attachment)
	}
}

func serveStoredObject(c *gin.Context, store storage.Storage, key string) {
	contentType := services.ContentTypeForKey(key)
	serveStoredObjectWithHeaders(c, store, key, contentType, "inline")
}

func serveMessageAttachmentObject(c *gin.Context, store storage.Storage, key string, attachment *models.MessageAttachment) {
	contentType := strings.TrimSpace(attachment.ContentType)
	if contentType == "" {
		contentType = services.ContentTypeForKey(key)
	}

	disposition := "inline"
	if attachment.FileType == "file" {
		filename := services.SanitizeAttachmentFilename(attachment.OriginalFilename, filepath.Ext(key))
		disposition = mime.FormatMediaType("attachment", map[string]string{"filename": filename})
	}

	serveStoredObjectWithHeaders(c, store, key, contentType, disposition)
}

func serveStoredObjectWithHeaders(c *gin.Context, store storage.Storage, key string, contentType string, disposition string) {
	if filePath, ok := storage.LocalPath(store, key); ok {
		setStoredObjectHeaders(c, contentType, disposition)
		c.File(filePath)
		return
	}

	signedURL, err := storage.SignedURL(c.Request.Context(), store, key, 15*time.Minute)
	if err != nil {
		c.JSON(404, gin.H{"error": "attachment file not found"})
		return
	}
	setStoredObjectHeaders(c, contentType, disposition)
	proxyStoredObject(c, signedURL)
}

func setStoredObjectHeaders(c *gin.Context, contentType string, disposition string) {
	if contentType != "" {
		c.Header("Content-Type", contentType)
	}
	if disposition == "" {
		disposition = "inline"
	}
	c.Header("Content-Disposition", disposition)
	c.Header("Accept-Ranges", "bytes")
}

func proxyStoredObject(c *gin.Context, signedURL string) {
	if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
		c.Status(http.StatusMethodNotAllowed)
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, signedURL, nil)
	if err != nil {
		c.JSON(404, gin.H{"error": "attachment file not found"})
		return
	}
	if rangeHeader := c.GetHeader("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := http.DefaultClient.Do(req)
	if resp != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		c.JSON(404, gin.H{"error": "attachment file not found"})
		return
	}
	if resp.StatusCode >= http.StatusBadRequest {
		c.JSON(resp.StatusCode, gin.H{"error": "attachment file not found"})
		return
	}

	for _, header := range []string{"Content-Length", "Content-Range", "Last-Modified", "ETag"} {
		if value := resp.Header.Get(header); value != "" {
			c.Header(header, value)
		}
	}
	if acceptRanges := resp.Header.Get("Accept-Ranges"); acceptRanges != "" {
		c.Header("Accept-Ranges", acceptRanges)
	}

	c.Status(resp.StatusCode)
	if c.Request.Method == http.MethodHead {
		return
	}

	if _, err := io.Copy(c.Writer, resp.Body); err != nil {
		return
	}
}
