package services

import (
	"fmt"
	"testing"
	"time"

	"notifications/dto"
	"notifications/hub"
	"notifications/models"
	"notifications/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCreateNotificationDedupesDuplicateDelivery(t *testing.T) {
	db := newNotificationTestDB(t)
	notificationHub := hub.NewHub()
	service := NewService(repository.NewRepository(db), notificationHub, nil)
	client, cleanup := notificationHub.AddClient(10)
	defer cleanup()

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

	select {
	case <-client:
	case <-time.After(time.Second):
		t.Fatal("expected first notification to be delivered to hub")
	}

	select {
	case duplicate := <-client:
		t.Fatalf("duplicate delivery reached hub: %+v", duplicate)
	default:
	}
}

func TestCreateMessageNotificationAlreadyReadStillDeliversEvent(t *testing.T) {
	db := newNotificationTestDB(t)
	notificationHub := hub.NewHub()
	service := NewService(repository.NewRepository(db), notificationHub, nil)
	client, cleanup := notificationHub.AddClient(10)
	defer cleanup()

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

	select {
	case <-client:
	case <-time.After(time.Second):
		t.Fatal("expected message notification to be delivered even if message row is already read")
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
	service := NewService(repository.NewRepository(db), hub.NewHub(), nil)

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
	if !notes[0].IsRead {
		t.Fatal("expected matching conversation notification to be read")
	}
	if notes[1].IsRead {
		t.Fatal("expected other conversation notification to stay unread")
	}
	if notes[2].IsRead {
		t.Fatal("expected other recipient notification to stay unread")
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

func newNotificationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.Notification{}, &models.Message{}, &models.MessageAttachment{}); err != nil {
		t.Fatalf("migrate notification: %v", err)
	}
	return db
}
