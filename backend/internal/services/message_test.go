package services

import (
	"errors"
	"strconv"
	"testing"

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

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Friendship{},
		&models.Message{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
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
