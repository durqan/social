package services

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"
	"testing"

	"notifications/dto"
	"notifications/models"
	"notifications/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCreateNotificationDedupesDuplicateDelivery(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)

	req := &dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeMessage,
		EntityID:    30,
	}

	if err := service.CreateNotification(req); err != nil {
		t.Fatalf("first CreateNotification failed: %v", err)
	}
	if err := service.CreateNotification(req); err != nil {
		t.Fatalf("duplicate CreateNotification failed: %v", err)
	}

	var count int64
	if err := db.Model(&models.Notification{}).Count(&count).Error; err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 notification after duplicate delivery, got %d", count)
	}

}

func TestCreateMessageNotificationAlreadyReadStaysUnread(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)

	if err := db.Create(&models.Message{
		ID:     30,
		FromID: 20,
		ToID:   10,
		IsRead: true,
	}).Error; err != nil {
		t.Fatalf("seed read message: %v", err)
	}

	req := &dto.CreateNotificationReq{
		RecipientID:    10,
		ActorID:        20,
		Type:           dto.NotificationTypeMessage,
		EntityID:       30,
		ConversationID: 20,
	}

	if err := service.CreateNotification(req); err != nil {
		t.Fatalf("CreateNotification failed: %v", err)
	}

	var note models.Notification
	if err := db.First(&note, "recipient_id = ? AND entity_id = ?", 10, 30).Error; err != nil {
		t.Fatalf("load notification: %v", err)
	}
	if note.IsRead {
		t.Fatal("expected message notification to stay unread until read sync")
	}

}

func TestDedupeKeyIsDeterministic(t *testing.T) {
	req := dto.CreateNotificationReq{
		RecipientID:    10,
		ActorID:        20,
		Type:           dto.NotificationTypeIncomingCall,
		EntityID:       0,
		CallID:         "call-123",
		ConversationID: 20,
	}

	first := DedupeKey(req)
	second := DedupeKey(req)
	if first == "" {
		t.Fatal("expected non-empty dedupe key")
	}
	if first != second {
		t.Fatalf("expected deterministic dedupe key, got %q and %q", first, second)
	}

	req.CallID = "call-456"
	if first == DedupeKey(req) {
		t.Fatal("expected different call_id to produce a different dedupe key")
	}
}

func TestMarkMessageConversationReadMarksMatchingNotifications(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)

	unreadMatch := models.Notification{
		RecipientID:    10,
		ActorID:        20,
		Type:           dto.NotificationTypeMessage,
		EntityID:       1,
		ConversationID: 20,
		DedupeKey:      "match",
	}
	unreadOtherConversation := models.Notification{
		RecipientID:    10,
		ActorID:        30,
		Type:           dto.NotificationTypeMessage,
		EntityID:       2,
		ConversationID: 30,
		DedupeKey:      "other-conversation",
	}
	unreadOtherUser := models.Notification{
		RecipientID:    11,
		ActorID:        20,
		Type:           dto.NotificationTypeMessage,
		EntityID:       3,
		ConversationID: 20,
		DedupeKey:      "other-user",
	}
	if err := db.Create(&[]models.Notification{
		unreadMatch,
		unreadOtherConversation,
		unreadOtherUser,
	}).Error; err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	if err := service.MarkMessageConversationRead(10, 20); err != nil {
		t.Fatalf("MarkMessageConversationRead failed: %v", err)
	}

	var notes []models.Notification
	if err := db.Order("entity_id").Find(&notes).Error; err != nil {
		t.Fatalf("load notifications: %v", err)
	}
	if !notes[0].IsRead || !notes[0].IsSeen {
		t.Fatal("expected matching conversation notification to be read and seen")
	}
	if notes[1].IsRead {
		t.Fatal("expected other conversation notification to stay unread")
	}
	if notes[2].IsRead {
		t.Fatal("expected other recipient notification to stay unread")
	}
}

func TestMarkAsSeenMarksOnlyCurrentUsersNotifications(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)
	notes := []models.Notification{
		{
			RecipientID: 10,
			ActorID:     20,
			Type:        dto.NotificationTypeFriendRequest,
			EntityID:    1,
			DedupeKey:   "seen-owner",
		},
		{
			RecipientID: 11,
			ActorID:     20,
			Type:        dto.NotificationTypeFriendRequest,
			EntityID:    2,
			DedupeKey:   "seen-other-user",
		},
	}
	if err := db.Create(&notes).Error; err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	if err := service.MarkAsSeen(10, []uint{notes[0].ID, notes[1].ID}); err != nil {
		t.Fatalf("MarkAsSeen failed: %v", err)
	}

	var got []models.Notification
	if err := db.Order("entity_id").Find(&got).Error; err != nil {
		t.Fatalf("load notifications: %v", err)
	}
	if !got[0].IsSeen || got[0].IsRead {
		t.Fatalf("owner notification seen/read = %v/%v, want seen only", got[0].IsSeen, got[0].IsRead)
	}
	if got[1].IsSeen {
		t.Fatal("foreign notification was marked seen")
	}
}

func TestMarkMatchingAsReadSupportsConversationAndMarksSeen(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)
	notes := []models.Notification{
		{
			RecipientID:    10,
			ActorID:        20,
			Type:           dto.NotificationTypeMessage,
			EntityID:       1,
			ConversationID: 20,
			DedupeKey:      "conversation-match",
		},
		{
			RecipientID:    10,
			ActorID:        30,
			Type:           dto.NotificationTypeMessage,
			EntityID:       2,
			ConversationID: 30,
			DedupeKey:      "conversation-other",
		},
	}
	if err := db.Create(&notes).Error; err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	conversationID := uint(20)
	if err := service.MarkMatchingAsRead(10, dto.MarkNotificationsReadReq{
		Types:          []string{dto.NotificationTypeMessage},
		ConversationID: &conversationID,
	}); err != nil {
		t.Fatalf("MarkMatchingAsRead failed: %v", err)
	}

	var got []models.Notification
	if err := db.Order("entity_id").Find(&got).Error; err != nil {
		t.Fatalf("load notifications: %v", err)
	}
	if !got[0].IsRead || !got[0].IsSeen {
		t.Fatal("expected matching conversation notification to be read and seen")
	}
	if got[1].IsRead || got[1].IsSeen {
		t.Fatal("expected other conversation notification to stay unread and unseen")
	}
}

func TestMessagePushTagUsesStableConversationTag(t *testing.T) {
	notification := models.Notification{
		Type:           dto.NotificationTypeMessage,
		ActorID:        20,
		ConversationID: 20,
	}

	payload := buildPushPayload(notification, nil)
	if payload.Tag != "message:20" {
		t.Fatalf("payload tag = %q, want message:20", payload.Tag)
	}
}

func TestMessagePreviewDecryptsEncryptedAtRestContent(t *testing.T) {
	t.Setenv("MESSAGE_ENCRYPTION_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	ciphertext, nonce := encryptNotificationTestMessage(t, "encrypted preview")

	got := messagePreview(models.Message{
		ID:                30,
		EncryptionVersion: 1,
		Ciphertext:        ciphertext,
		Nonce:             nonce,
	})

	if got != "encrypted preview" {
		t.Fatalf("messagePreview() = %q, want decrypted preview", got)
	}
}

func TestMessagePreviewFallsBackWhenEncryptedContentCannotBeRead(t *testing.T) {
	t.Setenv("MESSAGE_ENCRYPTION_KEY", "")

	got := messagePreview(models.Message{
		ID:                31,
		EncryptionVersion: 1,
		Ciphertext:        "bad",
		Nonce:             "bad",
	})

	if got != "Новое сообщение" {
		t.Fatalf("messagePreview() = %q, want safe fallback", got)
	}
}

func encryptNotificationTestMessage(t *testing.T, plaintext string) (string, string) {
	t.Helper()

	key, err := base64.StdEncoding.DecodeString("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := []byte("123456789012")
	ciphertext := aead.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), base64.StdEncoding.EncodeToString(nonce)
}

func TestSaveMobilePushTokenUpsertsAndReactivatesToken(t *testing.T) {
	db := newNotificationTestDB(t)
	service := NewService(repository.NewRepository(db), nil)

	first := &dto.MobilePushTokenReq{
		UserID:   10,
		Provider: "fcm",
		Platform: "android",
		Token:    "same-device-token",
	}
	if err := service.SaveMobilePushToken(first); err != nil {
		t.Fatalf("first SaveMobilePushToken failed: %v", err)
	}
	if err := service.RevokeMobilePushToken(10, *first); err != nil {
		t.Fatalf("RevokeMobilePushToken failed: %v", err)
	}

	second := &dto.MobilePushTokenReq{
		UserID:   11,
		Provider: "fcm",
		Platform: "android",
		Token:    first.Token,
	}
	if err := service.SaveMobilePushToken(second); err != nil {
		t.Fatalf("second SaveMobilePushToken failed: %v", err)
	}

	var tokens []models.MobilePushToken
	if err := db.Find(&tokens).Error; err != nil {
		t.Fatalf("load mobile tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0].UserID != 11 || tokens[0].RevokedAt != nil {
		t.Fatalf("mobile token was not safely upserted: %+v", tokens)
	}
}

func TestUniqueMobilePushTokensDedupesByToken(t *testing.T) {
	tokens := []models.MobilePushToken{
		{ID: 1, Token: "same-token"},
		{ID: 2, Token: "same-token"},
		{ID: 3, Token: "other-token"},
	}

	unique := uniqueMobilePushTokens(tokens)
	if len(unique) != 2 {
		t.Fatalf("unique token count = %d, want 2: %+v", len(unique), unique)
	}
	if unique[0].ID != 1 || unique[1].ID != 3 {
		t.Fatalf("unique token order = %+v, want first occurrence order", unique)
	}
}

func newNotificationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(
		&models.Notification{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.MobilePushToken{},
	); err != nil {
		t.Fatalf("migrate notification: %v", err)
	}
	return db
}
