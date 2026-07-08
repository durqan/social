package services

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSendMessageRollsBackMessageWhenAttachmentInsertFails(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	attachmentErr := errors.New("attachment insert failed")
	if err := db.Callback().Create().Before("gorm:create").Register("test:fail_message_attachments", func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "MessageAttachment" {
			tx.AddError(attachmentErr)
		}
	}); err != nil {
		t.Fatal(err)
	}

	_, err := SendMessage(db, 1, 2, "", []models.MessageAttachment{
		{
			FileURL:  "messages/user_1/file.jpg",
			FileType: "image",
			Size:     128,
		},
	}, nil, MessageEncryptionInput{})
	if !errors.Is(err, attachmentErr) {
		t.Fatalf("SendMessage error = %v, want %v", err, attachmentErr)
	}

	var messageCount int64
	if err := db.Model(&models.Message{}).Count(&messageCount).Error; err != nil {
		t.Fatal(err)
	}
	if messageCount != 0 {
		t.Fatalf("messages persisted after attachment failure: got %d, want 0", messageCount)
	}

	var attachmentCount int64
	if err := db.Model(&models.MessageAttachment{}).Count(&attachmentCount).Error; err != nil {
		t.Fatal(err)
	}
	if attachmentCount != 0 {
		t.Fatalf("attachments persisted after attachment failure: got %d, want 0", attachmentCount)
	}
}

func TestSendMessagePersistsMessageAndAttachmentsAtomically(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "", []models.MessageAttachment{
		{
			FileURL:  "messages/user_1/file.jpg",
			FileType: "image",
			Size:     128,
		},
	}, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if message.ID == 0 {
		t.Fatal("SendMessage returned message without id")
	}
	if len(message.Attachments) != 1 {
		t.Fatalf("SendMessage returned %d attachments, want 1", len(message.Attachments))
	}
	if message.Attachments[0].MessageID != message.ID {
		t.Fatalf("attachment message_id = %d, want %d", message.Attachments[0].MessageID, message.ID)
	}

	var messageCount int64
	if err := db.Model(&models.Message{}).Count(&messageCount).Error; err != nil {
		t.Fatal(err)
	}
	if messageCount != 1 {
		t.Fatalf("messages count = %d, want 1", messageCount)
	}

	var attachmentCount int64
	if err := db.Model(&models.MessageAttachment{}).Count(&attachmentCount).Error; err != nil {
		t.Fatal(err)
	}
	if attachmentCount != 1 {
		t.Fatalf("attachments count = %d, want 1", attachmentCount)
	}

	var outbox models.NotificationOutbox
	if err := db.First(&outbox).Error; err != nil {
		t.Fatalf("expected notification outbox row: %v", err)
	}
	if outbox.RecipientID != 2 || outbox.ActorID != 1 || outbox.Type != "message_received" || outbox.EntityID != message.ID {
		t.Fatalf("unexpected notification outbox row: %+v", outbox)
	}
}

func TestSendMessageCreatesYouTubeLinkPreviewWhenMetadataFails(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	called := make(chan struct{}, 1)
	restore := SetYTDLPMetadataRunnerForTest(func(ctx context.Context, raw string) (LinkPreviewMetadata, error) {
		called <- struct{}{}
		return LinkPreviewMetadata{}, errors.New("yt-dlp failed")
	})
	defer restore()

	message, err := SendMessage(db, 1, 2, "watch https://youtu.be/abc", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if message.LinkPreview == nil {
		t.Fatal("SendMessage returned no link preview")
	}
	if message.LinkPreview.Provider != "youtube" {
		t.Fatalf("provider = %q, want youtube", message.LinkPreview.Provider)
	}
	if message.LinkPreview.Status != models.LinkPreviewStatusPreview {
		t.Fatalf("status = %q, want preview", message.LinkPreview.Status)
	}

	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("metadata resolver was not called")
	}
}

func TestGetMessagesWithReturnsLinkPreviewMetadata(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message := models.Message{
		FromID:  1,
		ToID:    2,
		Content: "https://youtu.be/abc",
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	title := "Preview title"
	thumbnail := "https://i.ytimg.com/vi/abc/hqdefault.jpg"
	duration := 42
	if err := db.Create(&models.MessageLinkPreview{
		MessageID:       message.ID,
		OriginalURL:     "https://youtu.be/abc",
		Provider:        "youtube",
		Title:           &title,
		ThumbnailURL:    &thumbnail,
		DurationSeconds: &duration,
		Status:          models.LinkPreviewStatusPreview,
	}).Error; err != nil {
		t.Fatal(err)
	}

	messages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages len = %d, want 1", len(messages))
	}
	preview := messages[0].LinkPreview
	if preview == nil {
		t.Fatal("message has no link preview")
	}
	if preview.Title == nil || *preview.Title != title {
		t.Fatalf("title = %v, want %q", preview.Title, title)
	}
	if preview.ThumbnailURL == nil || *preview.ThumbnailURL != thumbnail {
		t.Fatalf("thumbnail = %v, want %q", preview.ThumbnailURL, thumbnail)
	}
	if preview.DurationSeconds == nil || *preview.DurationSeconds != duration {
		t.Fatalf("duration = %v, want %d", preview.DurationSeconds, duration)
	}
}

func TestLinkPreviewVideoAttachmentUsesPrivateThumbnailURL(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message := models.Message{
		FromID:  1,
		ToID:    2,
		Content: "https://www.instagram.com/reel/abc/",
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	attachment := models.MessageAttachment{
		MessageID:    message.ID,
		FileURL:      "chat-videos/1/video.mp4",
		ThumbnailURL: "chat-video-thumbnails/1/thumb.jpg",
		FileType:     "video",
		ContentType:  "video/mp4",
		Size:         123,
	}
	if err := db.Create(&attachment).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MessageLinkPreview{
		MessageID:         message.ID,
		OriginalURL:       "https://www.instagram.com/reel/abc/",
		Provider:          "instagram",
		Status:            models.LinkPreviewStatusReady,
		VideoAttachmentID: &attachment.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}

	messages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages len = %d, want 1", len(messages))
	}
	if messages[0].LinkPreview == nil || messages[0].LinkPreview.VideoAttachment == nil {
		t.Fatal("message link preview did not preload video attachment")
	}

	response := WithPrivateAttachmentURLs(messages[0])
	preview := response.LinkPreview
	if preview == nil || preview.VideoAttachment == nil {
		t.Fatal("response link preview has no video attachment")
	}
	wantThumb := PrivateAttachmentThumbnailURL(attachment.ID)
	if preview.VideoAttachment.ThumbnailURL != wantThumb {
		t.Fatalf("video attachment thumbnail = %q, want %q", preview.VideoAttachment.ThumbnailURL, wantThumb)
	}
	if preview.ThumbnailURL == nil || *preview.ThumbnailURL != wantThumb {
		t.Fatalf("preview thumbnail = %v, want %q", preview.ThumbnailURL, wantThumb)
	}
}

func TestLinkPreviewVideoAttachmentFallbackUsesPrivateThumbnailURL(t *testing.T) {
	attachmentID := uint(44)
	message := models.Message{
		Attachments: []models.MessageAttachment{{
			ID:           attachmentID,
			FileURL:      "chat-videos/1/video.mp4",
			ThumbnailURL: "chat-video-thumbnails/1/thumb.jpg",
			FileType:     "video",
		}},
		LinkPreview: &models.MessageLinkPreview{
			VideoAttachmentID: &attachmentID,
		},
	}

	response := WithPrivateAttachmentURLs(message)
	preview := response.LinkPreview
	if preview == nil || preview.VideoAttachment == nil {
		t.Fatal("response link preview has no fallback video attachment")
	}
	wantThumb := PrivateAttachmentThumbnailURL(attachmentID)
	if preview.VideoAttachment.ThumbnailURL != wantThumb {
		t.Fatalf("video attachment thumbnail = %q, want %q", preview.VideoAttachment.ThumbnailURL, wantThumb)
	}
	if preview.ThumbnailURL == nil || *preview.ThumbnailURL != wantThumb {
		t.Fatalf("preview thumbnail = %v, want %q", preview.ThumbnailURL, wantThumb)
	}
}

func TestStoredLinkPreviewThumbnailUsesPrivateURL(t *testing.T) {
	storedThumbnail := "link-preview-thumbnails/10/20.jpg"
	message := models.Message{
		LinkPreview: &models.MessageLinkPreview{
			ID:           20,
			ThumbnailURL: &storedThumbnail,
		},
	}

	response := WithPrivateAttachmentURLs(message)
	if response.LinkPreview == nil || response.LinkPreview.ThumbnailURL == nil {
		t.Fatal("response link preview has no thumbnail")
	}
	want := PrivateLinkPreviewThumbnailURL(20)
	if *response.LinkPreview.ThumbnailURL != want {
		t.Fatalf("thumbnail = %q, want %q", *response.LinkPreview.ThumbnailURL, want)
	}
}

func TestSendMessageUpdatesSenderLastSeen(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	beforeSend := time.Now().UTC().Add(-time.Second)
	if _, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{}); err != nil {
		t.Fatal(err)
	}

	var sender models.User
	if err := db.First(&sender, 1).Error; err != nil {
		t.Fatal(err)
	}
	if sender.LastSeenAt == nil {
		t.Fatal("sender last_seen_at was not updated")
	}
	if sender.LastSeenAt.Before(beforeSend) {
		t.Fatalf("sender last_seen_at = %s, want after %s", sender.LastSeenAt, beforeSend)
	}
}

func TestMarkConversationReadUpdatesReaderLastSeen(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	if _, err := SendMessage(db, 2, 1, "unread", nil, nil, MessageEncryptionInput{}); err != nil {
		t.Fatal(err)
	}

	beforeRead := time.Now().UTC().Add(-time.Second)
	if err := MarkConversationRead(db, 2, 1); err != nil {
		t.Fatal(err)
	}

	var reader models.User
	if err := db.First(&reader, 1).Error; err != nil {
		t.Fatal(err)
	}
	if reader.LastSeenAt == nil {
		t.Fatal("reader last_seen_at was not updated")
	}
	if reader.LastSeenAt.Before(beforeRead) {
		t.Fatalf("reader last_seen_at = %s, want after %s", reader.LastSeenAt, beforeRead)
	}
}

func TestMarkUserActivityIsThrottled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedUser(t, db, 10)

	first, err := MarkUserActivity(db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if first == nil {
		t.Fatal("first activity update was throttled")
	}

	second, err := MarkUserActivity(db, 10)
	if err != nil {
		t.Fatal(err)
	}
	if second != nil {
		t.Fatal("second activity update was not throttled")
	}
}

func TestSendMessageEncryptsTextAtRest(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	const plaintext = "server-encryption-test-123"
	message, err := SendMessage(db, 1, 2, plaintext, nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if message.Content != "" {
		t.Fatalf("returned stored content = %q, want empty content at rest", message.Content)
	}
	if message.EncryptionVersion != 1 || message.Ciphertext == "" || message.Nonce == "" {
		t.Fatalf("encrypted message fields were not persisted: %+v", message)
	}
	if strings.Contains(message.Content, plaintext) || strings.Contains(message.Ciphertext, plaintext) {
		t.Fatalf("plaintext leaked into stored message: %+v", message)
	}
}

func TestSendMessageDoesNotStorePlaintextInMessagesContent(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	const plaintext = "pg-dump-search-test-456"
	message, err := SendMessage(db, 1, 2, plaintext, nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	var stored models.Message
	if err := db.First(&stored, message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.Content, plaintext) {
		t.Fatalf("messages.content contains plaintext: %q", stored.Content)
	}
	if stored.EncryptionVersion != 1 || stored.Ciphertext == "" || stored.Nonce == "" {
		t.Fatalf("stored encrypted fields = %+v, want version/ciphertext/nonce", stored)
	}
}

func TestSendMessageStoresClientEncryptedPayloadWithoutServerDecrypt(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)
	seedE2EEBackup(t, db, 2)

	encryption := testClientE2EEMessageEncryption(1, 2)
	message, err := SendMessage(db, 1, 2, "", nil, nil, encryption)
	if err != nil {
		t.Fatal(err)
	}
	if message.Content != "" ||
		message.EncryptionVersion != 1 ||
		message.Ciphertext != encryption.Ciphertext ||
		message.Nonce != encryption.Nonce {
		t.Fatalf("stored client E2EE message = %+v", message)
	}

	response := WithPrivateAttachmentURLs(message)
	if response.Content != "" ||
		response.EncryptionVersion != 1 ||
		response.Ciphertext != encryption.Ciphertext ||
		response.Nonce != encryption.Nonce {
		t.Fatalf("client E2EE response was server-decrypted or cleared: %+v", response)
	}
}

func TestSendMessageRejectsPlaintextWhenE2EERequired(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)

	_, err := SendMessage(db, 1, 2, "plaintext must not be accepted", nil, nil, MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestSendMessagePersistsEncryptedAttachmentMetadata(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)
	seedE2EEBackup(t, db, 2)

	message, err := SendMessage(db, 1, 2, "", []models.MessageAttachment{
		{
			FileURL:           "encrypted/user_1/attachment.bin",
			FileType:          "image",
			Size:              128,
			EncryptionVersion: 1,
			EncryptedFileKey:  `{"version":1,"keyAlg":"RSA-OAEP-SHA-256","keys":{"1":"a2V5","2":"a2V5"}}`,
			FileNonce:         "MTIzNDU2Nzg5MDEy",
			EncryptedMetadata: `{"version":1,"alg":"AES-256-GCM","nonce":"MTIzNDU2Nzg5MDEy","data":"bWV0YQ=="}`,
		},
	}, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(message.Attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(message.Attachments))
	}
	attachment := message.Attachments[0]
	if attachment.EncryptionVersion != 1 ||
		attachment.EncryptedFileKey == "" ||
		attachment.FileNonce == "" ||
		attachment.EncryptedMetadata == "" {
		t.Fatalf("encrypted attachment fields were not persisted: %+v", attachment)
	}
	if attachment.OriginalFilename != "" || attachment.ContentType != "" {
		t.Fatalf("encrypted attachment leaked plaintext metadata: %+v", attachment)
	}
}

func TestSendMessageRejectsPlaintextAttachmentWhenE2EERequired(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)
	seedE2EEBackup(t, db, 2)

	_, err := SendMessage(db, 1, 2, "", []models.MessageAttachment{
		{
			FileURL:          "messages/user_1/plain.jpg",
			FileType:         "image",
			OriginalFilename: "plain.jpg",
			ContentType:      "image/jpeg",
			Size:             128,
		},
	}, nil, MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestReadMessagesReturnsDecryptedContent(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	const plaintext = "read-decrypted-test-789"
	if _, err := SendMessage(db, 1, 2, plaintext, nil, nil, MessageEncryptionInput{}); err != nil {
		t.Fatal(err)
	}

	messages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := WithPrivateAttachmentURLsForMessages(messages)
	if len(response) != 1 {
		t.Fatalf("messages count = %d, want 1", len(response))
	}
	if response[0].Content != plaintext {
		t.Fatalf("response content = %q, want %q", response[0].Content, plaintext)
	}
	if response[0].EncryptionVersion != 0 || response[0].Ciphertext != "" || response[0].Nonce != "" {
		t.Fatalf("response leaked encryption fields: %+v", response[0])
	}
}

func TestReplyPreviewReturnsDecryptedContent(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	original, err := SendMessage(db, 1, 2, "reply-preview-secret", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SendMessage(db, 2, 1, "reply body", nil, &original.ID, MessageEncryptionInput{}); err != nil {
		t.Fatal(err)
	}

	messages, err := repository.GetMessagesBetweenPaginated(db, 2, 1, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := WithPrivateAttachmentURLsForMessages(messages)
	if len(response) != 2 {
		t.Fatalf("messages count = %d, want 2", len(response))
	}
	if response[1].ReplyToMessage == nil {
		t.Fatal("reply preview is missing")
	}
	if response[1].ReplyToMessage.Content != "reply-preview-secret" {
		t.Fatalf("reply preview content = %q", response[1].ReplyToMessage.Content)
	}
}

func TestPinnedMessageReturnsDecryptedContent(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "pinned-preview-secret", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	pin, err := PinMessage(db, 1, 2, message.ID)
	if err != nil {
		t.Fatal(err)
	}

	response := WithPrivateAttachmentURLs(pin.Message)
	if response.Content != "pinned-preview-secret" {
		t.Fatalf("pinned message content = %q", response.Content)
	}
}

func TestLegacyPlaintextMessageReadsAsBefore(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	legacy := models.Message{FromID: 1, ToID: 2, Content: "legacy plaintext", EncryptionVersion: 0}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	messages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	response := WithPrivateAttachmentURLsForMessages(messages)
	if len(response) != 1 || response[0].Content != "legacy plaintext" {
		t.Fatalf("legacy response = %+v, want plaintext", response)
	}
}

func TestGetMessagesBeforeCursorUsesCreatedAtAndID(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	base := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	seedMessages := []models.Message{
		{ID: 100, FromID: 1, ToID: 2, Content: "oldest", CreatedAt: base},
		{ID: 50, FromID: 1, ToID: 2, Content: "middle", CreatedAt: base.Add(time.Minute)},
		{ID: 40, FromID: 1, ToID: 2, Content: "newest", CreatedAt: base.Add(2 * time.Minute)},
	}
	if err := db.Create(&seedMessages).Error; err != nil {
		t.Fatal(err)
	}

	firstPage, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage) != 2 || firstPage[0].ID != 50 || firstPage[1].ID != 40 {
		t.Fatalf("first page ids = %+v, want [50 40]", messageIDs(firstPage))
	}

	before := firstPage[0].ID
	secondPage, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 2, &before)
	if err != nil {
		t.Fatal(err)
	}
	if len(secondPage) != 1 || secondPage[0].ID != 100 {
		t.Fatalf("second page ids = %+v, want [100]", messageIDs(secondPage))
	}
}

func TestConversationListUsesBatchedUnreadAndAttachmentPreview(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	first := models.Message{FromID: 2, ToID: 1, Content: "unread", IsRead: false}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	latest := models.Message{FromID: 2, ToID: 1, Content: "", IsRead: false, CreatedAt: time.Now().Add(time.Minute)}
	if err := db.Create(&latest).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MessageAttachment{
		MessageID: latest.ID,
		FileURL:   "messages/user_2/voice.ogg",
		FileType:  "voice",
		Size:      12,
	}).Error; err != nil {
		t.Fatal(err)
	}

	conversations, err := repository.GetConversations(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 {
		t.Fatalf("conversations count = %d, want 1", len(conversations))
	}
	if conversations[0]["last_message"] != "Голосовое сообщение" {
		t.Fatalf("last_message = %v, want voice preview", conversations[0]["last_message"])
	}
	if intFromMap(conversations[0], "unread_count") != 2 {
		t.Fatalf("unread_count = %v, want 2", conversations[0]["unread_count"])
	}
}

func TestSendMessageFailsWithoutEncryptionKey(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	t.Setenv("MESSAGE_ENCRYPTION_KEY", "")

	_, err := SendMessage(db, 1, 2, "must not be stored", nil, nil, MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageEncryptionUnavailable) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageEncryptionUnavailable)
	}
}

func TestConversationPreviewDecryptsWithoutPlaintextAtRest(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	const plaintext = "conversation-preview-secret"
	message, err := SendMessage(db, 1, 2, plaintext, nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	var stored models.Message
	if err := db.First(&stored, message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.Content, plaintext) {
		t.Fatalf("stored preview source contains plaintext: %q", stored.Content)
	}

	conversations, err := GetConversations(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 {
		t.Fatalf("conversations count = %d, want 1", len(conversations))
	}
	if conversations[0]["last_message"] != plaintext {
		t.Fatalf("last_message = %v, want %q", conversations[0]["last_message"], plaintext)
	}
	if _, exists := conversations[0]["last_ciphertext"]; exists {
		t.Fatalf("conversation response leaked crypto fields: %+v", conversations[0])
	}
}

func TestConversationsIncludeParticipantLastSeen(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	if _, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{}); err != nil {
		t.Fatal(err)
	}

	conversations, err := GetConversations(db, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(conversations) != 1 {
		t.Fatalf("conversations count = %d, want 1", len(conversations))
	}
	if conversations[0]["last_seen_at"] == nil {
		t.Fatalf("conversation missing last_seen_at: %+v", conversations[0])
	}
}

func TestDeleteMessageForEveryoneAllowsOnlySender(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedUser(t, db, 3)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 2, message.ID, MessageDeleteForEveryone); !errors.Is(err, ErrMessageForbidden) {
		t.Fatalf("recipient delete for everyone error = %v, want %v", err, ErrMessageForbidden)
	}
	if _, err := DeleteMessageForUser(db, 3, message.ID, MessageDeleteForEveryone); !errors.Is(err, ErrMessageForbidden) {
		t.Fatalf("outsider delete for everyone error = %v, want %v", err, ErrMessageForbidden)
	}

	deleted, err := DeleteMessageForUser(db, 1, message.ID, MessageDeleteForEveryone)
	if err != nil {
		t.Fatal(err)
	}
	if deleted.ID != message.ID {
		t.Fatalf("deleted message id = %d, want %d", deleted.ID, message.ID)
	}

	var visible models.Message
	if err := db.First(&visible, message.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("message visible after delete for everyone error = %v, want %v", err, gorm.ErrRecordNotFound)
	}

	var stored models.Message
	if err := db.Unscoped().First(&stored, message.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !stored.DeletedAt.Valid {
		t.Fatal("message was not soft-deleted")
	}
	if stored.DeletedForEveryoneBy == nil || *stored.DeletedForEveryoneBy != 1 {
		t.Fatalf("deleted_for_everyone_by = %v, want 1", stored.DeletedForEveryoneBy)
	}

	if _, err := DeleteMessageForUser(db, 1, message.ID, MessageDeleteForEveryone); err != nil {
		t.Fatalf("repeated delete for everyone error = %v, want nil", err)
	}

	assertVisibleMessageIDs(t, db, 1, 2, nil)
	assertVisibleMessageIDs(t, db, 2, 1, nil)
}

func TestToggleMessageReactionCreatesReplacesAndRemovesReaction(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	_, summaries, _, err := ToggleMessageReaction(db, 1, message.ID, "👍")
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 || summaries[0].Emoji != "👍" || summaries[0].Count != 1 || !summaries[0].ReactedByMe {
		t.Fatalf("unexpected created reaction summaries: %+v", summaries)
	}

	_, summaries, _, err = ToggleMessageReaction(db, 1, message.ID, "🔥")
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 || summaries[0].Emoji != "🔥" || summaries[0].Count != 1 || !summaries[0].ReactedByMe {
		t.Fatalf("unexpected replaced reaction summaries: %+v", summaries)
	}

	_, summaries, _, err = ToggleMessageReaction(db, 1, message.ID, "🔥")
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 0 {
		t.Fatalf("reaction was not removed: %+v", summaries)
	}
}

func TestToggleMessageReactionRejectsOutsiderAndUnsupportedEmoji(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedUser(t, db, 3)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, _, _, err := ToggleMessageReaction(db, 3, message.ID, "👍"); !errors.Is(err, ErrMessageForbidden) {
		t.Fatalf("outsider reaction error = %v, want %v", err, ErrMessageForbidden)
	}
	if _, _, _, err := ToggleMessageReaction(db, 1, message.ID, "💣"); !errors.Is(err, ErrMessageInvalidReaction) {
		t.Fatalf("unsupported reaction error = %v, want %v", err, ErrMessageInvalidReaction)
	}

	if _, err := DeleteMessageForUser(db, 2, message.ID, MessageDeleteForMe); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := ToggleMessageReaction(db, 2, message.ID, "👍"); !errors.Is(err, ErrMessageForbidden) {
		t.Fatalf("hidden message reaction error = %v, want %v", err, ErrMessageForbidden)
	}
}

func TestMessageReactionSummariesArePersonalizedForEachParticipant(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	_, _, version, err := ToggleMessageReaction(db, 1, message.ID, "❤️")
	if err != nil {
		t.Fatal(err)
	}
	if version != 1 {
		t.Fatalf("reaction version after user A add = %d, want 1", version)
	}
	assertReactionSummary(t, db, message.ID, 1, "❤️", 1, true)
	assertReactionSummary(t, db, message.ID, 2, "❤️", 1, false)

	_, _, version, err = ToggleMessageReaction(db, 2, message.ID, "❤️")
	if err != nil {
		t.Fatal(err)
	}
	if version != 2 {
		t.Fatalf("reaction version after user B add = %d, want 2", version)
	}
	assertReactionSummary(t, db, message.ID, 1, "❤️", 2, true)
	assertReactionSummary(t, db, message.ID, 2, "❤️", 2, true)

	_, _, version, err = ToggleMessageReaction(db, 1, message.ID, "❤️")
	if err != nil {
		t.Fatal(err)
	}
	if version != 3 {
		t.Fatalf("reaction version after user A remove = %d, want 3", version)
	}
	assertReactionSummary(t, db, message.ID, 1, "❤️", 1, false)
	assertReactionSummary(t, db, message.ID, 2, "❤️", 1, true)

	_, _, version, err = ToggleMessageReaction(db, 2, message.ID, "😂")
	if err != nil {
		t.Fatal(err)
	}
	if version != 4 {
		t.Fatalf("reaction version after user B switch = %d, want 4", version)
	}
	assertReactionSummary(t, db, message.ID, 1, "😂", 1, false)
	assertReactionSummary(t, db, message.ID, 2, "😂", 1, true)

	userAMessages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	userBMessages, err := repository.GetMessagesBetweenPaginated(db, 2, 1, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(userAMessages) != 1 || len(userBMessages) != 1 {
		t.Fatalf("history lengths = A:%d B:%d, want 1 each", len(userAMessages), len(userBMessages))
	}
	assertSingleReaction(t, userAMessages[0].Reactions, "😂", 1, false)
	assertSingleReaction(t, userBMessages[0].Reactions, "😂", 1, true)
	if userAMessages[0].ReactionVersion != 4 || userBMessages[0].ReactionVersion != 4 {
		t.Fatalf(
			"history reaction versions = A:%d B:%d, want 4",
			userAMessages[0].ReactionVersion,
			userBMessages[0].ReactionVersion,
		)
	}
}

func assertReactionSummary(t *testing.T, db *gorm.DB, messageID, userID uint, emoji string, count int, reactedByMe bool) {
	t.Helper()

	summaries, err := repository.GetReactionSummaries(db, messageID, userID)
	if err != nil {
		t.Fatal(err)
	}
	assertSingleReaction(t, summaries, emoji, count, reactedByMe)
}

func assertSingleReaction(t *testing.T, summaries []models.ReactionSummary, emoji string, count int, reactedByMe bool) {
	t.Helper()

	if len(summaries) != 1 {
		t.Fatalf("reaction summaries = %+v, want one summary", summaries)
	}
	summary := summaries[0]
	if summary.Emoji != emoji || summary.Count != count || summary.ReactedByMe != reactedByMe {
		t.Fatalf(
			"reaction summary = %+v, want emoji=%s count=%d reactedByMe=%v",
			summary,
			emoji,
			count,
			reactedByMe,
		)
	}
}

func TestDeleteMessageForMeHidesOnlyCurrentUser(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 1, message.ID, MessageDeleteForMe); err != nil {
		t.Fatal(err)
	}
	if _, err := DeleteMessageForUser(db, 1, message.ID, MessageDeleteForMe); err != nil {
		t.Fatalf("repeated delete for me error = %v, want nil", err)
	}

	assertVisibleMessageIDs(t, db, 1, 2, nil)
	assertVisibleMessageIDs(t, db, 2, 1, []uint{message.ID})

	var stored models.Message
	if err := db.First(&stored, message.ID).Error; err != nil {
		t.Fatalf("message should remain visible to other participants: %v", err)
	}

	var deletions int64
	if err := db.Model(&models.MessageUserDeletion{}).
		Where("message_id = ? AND user_id = ?", message.ID, 1).
		Count(&deletions).Error; err != nil {
		t.Fatal(err)
	}
	if deletions != 1 {
		t.Fatalf("message_user_deletions count = %d, want 1", deletions)
	}
}

func TestRecipientCanDeleteForeignMessageForMe(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 2, message.ID, MessageDeleteForMe); err != nil {
		t.Fatal(err)
	}

	assertVisibleMessageIDs(t, db, 2, 1, nil)
	assertVisibleMessageIDs(t, db, 1, 2, []uint{message.ID})
}

func TestOutsiderCannotDeleteMessageForMe(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedUser(t, db, 3)

	message, err := SendMessage(db, 1, 2, "hello", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 3, message.ID, MessageDeleteForMe); !errors.Is(err, ErrMessageForbidden) {
		t.Fatalf("outsider delete for me error = %v, want %v", err, ErrMessageForbidden)
	}

	assertVisibleMessageIDs(t, db, 1, 2, []uint{message.ID})
	assertVisibleMessageIDs(t, db, 2, 1, []uint{message.ID})
}

func TestDeleteForMeIsExcludedFromReadModelsForThatUser(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 2, 1, "unread", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 1, message.ID, MessageDeleteForMe); err != nil {
		t.Fatal(err)
	}

	assertVisibleMessageIDs(t, db, 1, 2, nil)
	assertVisibleMessageIDs(t, db, 2, 1, []uint{message.ID})

	unread, err := repository.GetUnreadCount(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if unread != 0 {
		t.Fatalf("unread count = %d, want 0", unread)
	}

	recipientConversations, err := repository.GetConversations(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(recipientConversations) != 0 {
		t.Fatalf("recipient conversations = %d, want 0", len(recipientConversations))
	}

	senderConversations, err := repository.GetConversations(db, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(senderConversations) != 1 {
		t.Fatalf("sender conversations = %d, want 1", len(senderConversations))
	}
}

func TestDeleteForMeHidesDeletedReplyPreviewOnlyForThatUser(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	original, err := SendMessage(db, 1, 2, "original", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	reply, err := SendMessage(db, 2, 1, "reply", nil, &original.ID, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := DeleteMessageForUser(db, 1, original.ID, MessageDeleteForMe); err != nil {
		t.Fatal(err)
	}

	userMessages, err := repository.GetMessagesBetweenPaginated(db, 1, 2, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(userMessages) != 1 || userMessages[0].ID != reply.ID {
		t.Fatalf("user visible messages = %+v, want only reply %d", userMessages, reply.ID)
	}
	if userMessages[0].ReplyToMessage != nil {
		t.Fatal("reply preview should be hidden for the user who deleted the original")
	}

	otherMessages, err := repository.GetMessagesBetweenPaginated(db, 2, 1, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(otherMessages) != 2 {
		t.Fatalf("other participant visible messages = %d, want 2", len(otherMessages))
	}
	if otherMessages[1].ReplyToMessage == nil || otherMessages[1].ReplyToMessage.ID != original.ID {
		t.Fatal("reply preview should remain visible for the other participant")
	}
}

func newMessageServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	t.Setenv("MESSAGE_ENCRYPTION_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Friendship{},
		&models.Message{},
		&models.MessageReaction{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
		&models.MessageLinkPreview{},
		&models.ConversationPin{},
		&models.PinnedMessage{},
		&models.EncryptedKeyBackup{},
		&models.NotificationOutbox{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func assertVisibleMessageIDs(t *testing.T, db *gorm.DB, userID, otherID uint, want []uint) {
	t.Helper()

	messages, err := repository.GetMessagesBetweenPaginated(db, userID, otherID, 20, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != len(want) {
		t.Fatalf("visible messages for %d = %d, want %d", userID, len(messages), len(want))
	}
	for i, message := range messages {
		if message.ID != want[i] {
			t.Fatalf("visible message[%d] for %d = %d, want %d", i, userID, message.ID, want[i])
		}
	}
}

func messageIDs(messages []models.Message) []uint {
	ids := make([]uint, 0, len(messages))
	for _, message := range messages {
		ids = append(ids, message.ID)
	}
	return ids
}

func seedAcceptedFriendship(t *testing.T, db *gorm.DB, userID, friendID uint) {
	t.Helper()

	seedUser(t, db, userID)
	seedUser(t, db, friendID)
	seedFriendship(t, db, userID, friendID)
}

func seedUser(t *testing.T, db *gorm.DB, userID uint) {
	t.Helper()

	if err := db.Create(&models.User{
		ID:       userID,
		Name:     "User",
		Email:    "user" + strconv.FormatUint(uint64(userID), 10) + "@example.com",
		Password: "x",
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func seedFriendship(t *testing.T, db *gorm.DB, userID, friendID uint) {
	t.Helper()

	if err := db.Create(&models.Friendship{UserID: userID, FriendID: friendID, Status: "accepted"}).Error; err != nil {
		t.Fatal(err)
	}
}

func seedE2EEBackup(t *testing.T, db *gorm.DB, userID uint) {
	t.Helper()

	if err := db.Create(&models.EncryptedKeyBackup{
		UserID:             userID,
		EncryptedMasterKey: `{"publicKey":"test-public-key"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func testClientE2EEMessageEncryption(fromID, toID uint) MessageEncryptionInput {
	return MessageEncryptionInput{
		Version: 1,
		Ciphertext: fmt.Sprintf(
			`{"version":1,"alg":"AES-256-GCM","keyAlg":"RSA-OAEP-SHA-256","data":"Y2lwaGVydGV4dA==","keys":{"%d":"a2V5","%d":"a2V5"}}`,
			fromID,
			toID,
		),
		Nonce: "MTIzNDU2Nzg5MDEy",
	}
}
