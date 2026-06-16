package services

import (
	"errors"
	"strconv"
	"testing"

	"tester/internal/models"

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

func TestSendMessageRejectsPlaintextWhenRecipientE2EEEnabled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 2)

	_, err := SendMessage(db, 1, 2, "plaintext", nil, nil, MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestSendMessageRejectsPlaintextAttachmentWhenRecipientE2EEEnabled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 2)

	_, err := SendMessage(db, 1, 2, "", []models.MessageAttachment{
		{
			FileURL:  "messages/user_1/file.jpg",
			FileType: "image",
			Size:     128,
		},
	}, nil, MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestSendMessageRejectsEncryptedPayloadUntilBothParticipantsE2EEEnabled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)

	_, err := SendMessage(db, 1, 2, "plaintext", nil, nil, MessageEncryptionInput{
		Version:    1,
		Ciphertext: `{"ciphertext":"abc"}`,
		Nonce:      "nonce",
	})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("SendMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestSendMessageAllowsEncryptedPayloadWhenBothParticipantsE2EEEnabled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedE2EEBackup(t, db, 1)
	seedE2EEBackup(t, db, 2)

	message, err := SendMessage(db, 1, 2, "plaintext", nil, nil, MessageEncryptionInput{
		Version:    1,
		Ciphertext: `{"ciphertext":"abc"}`,
		Nonce:      "nonce",
	})
	if err != nil {
		t.Fatal(err)
	}
	if message.Content != "" {
		t.Fatalf("encrypted message content = %q, want empty plaintext", message.Content)
	}
	if message.EncryptionVersion != 1 || message.Ciphertext == "" || message.Nonce == "" {
		t.Fatalf("encrypted message fields were not persisted: %+v", message)
	}
}

func TestUpdateMessageRejectsPlaintextWhenRecipientE2EEEnabled(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)

	message, err := SendMessage(db, 1, 2, "before e2ee", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	seedE2EEBackup(t, db, 2)

	_, err = UpdateMessage(db, 1, message.ID, "plaintext edit", MessageEncryptionInput{})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("UpdateMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func TestForwardMessageRejectsPlaintextToE2EEConversation(t *testing.T) {
	db := newMessageServiceTestDB(t)
	seedAcceptedFriendship(t, db, 1, 2)
	seedUser(t, db, 3)
	seedFriendship(t, db, 1, 3)

	message, err := SendMessage(db, 1, 2, "plaintext", nil, nil, MessageEncryptionInput{})
	if err != nil {
		t.Fatal(err)
	}
	seedE2EEBackup(t, db, 3)

	_, err = ForwardMessage(db, 1, message.ID, []uint{3})
	if !errors.Is(err, ErrMessageInvalidEncryption) {
		t.Fatalf("ForwardMessage error = %v, want %v", err, ErrMessageInvalidEncryption)
	}
}

func newMessageServiceTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Friendship{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.EncryptedKeyBackup{},
		&models.NotificationOutbox{},
	); err != nil {
		t.Fatal(err)
	}
	return db
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
