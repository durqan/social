package services

import (
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

func newNotificationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.Notification{}); err != nil {
		t.Fatalf("migrate notification: %v", err)
	}
	return db
}
