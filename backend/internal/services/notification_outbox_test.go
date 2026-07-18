package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"tester/internal/dto"
	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNotificationClientDeliversInternalRequest(t *testing.T) {
	var received dto.CreateNotificationReq
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/notifications" {
			t.Fatalf("request = %s %s, want POST /notifications", r.Method, r.URL.Path)
		}
		if token := r.Header.Get("X-Internal-Token"); token != "test-token" {
			t.Fatalf("internal token = %q, want test-token", token)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	client, err := newNotificationClient(server.URL, "test-token")
	if err != nil {
		t.Fatal(err)
	}
	want := dto.CreateNotificationReq{RecipientID: 10, ActorID: 20, Type: dto.NotificationTypeMessage, EntityID: 30}
	if err := client.deliver(context.Background(), want); err != nil {
		t.Fatal(err)
	}
	if received != want {
		t.Fatalf("received = %+v, want %+v", received, want)
	}
}

type fakeNotificationDelivery struct {
	err       error
	delivered []dto.CreateNotificationReq
}

func (d *fakeNotificationDelivery) deliver(_ context.Context, req dto.CreateNotificationReq) error {
	if d.err != nil {
		return d.err
	}
	d.delivered = append(d.delivered, req)
	return nil
}

func TestClaimNotificationOutboxBatchMarksPublishing(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	items, err := claimNotificationOutboxBatch(context.Background(), db, 10, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Status != NotificationOutboxStatusPublishing || items[0].LeaseToken == "" || items[0].LeaseUntil == nil {
		t.Fatalf("claimed items = %+v, want leased publishing item", items)
	}
	if items[0].Attempts != 1 {
		t.Fatalf("attempts = %d, want 1", items[0].Attempts)
	}
}

func TestClaimNotificationOutboxBatchReclaimsExpiredLease(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	now := time.Now()
	expired := now.Add(-time.Second)
	item := models.NotificationOutbox{
		RecipientID:   10,
		ActorID:       20,
		Type:          dto.NotificationTypeFriendRequest,
		DedupeKey:     "expired-lease",
		Status:        NotificationOutboxStatusPublishing,
		Attempts:      1,
		NextAttemptAt: now.Add(-time.Minute),
		LeaseToken:    "dead-worker",
		LeaseUntil:    &expired,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	items, err := claimNotificationOutboxBatch(context.Background(), db, 10, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].LeaseToken == "dead-worker" {
		t.Fatalf("reclaimed items = %+v, want a new lease", items)
	}
	if items[0].Attempts != 2 {
		t.Fatalf("attempts = %d, want 2", items[0].Attempts)
	}
}

func TestDeliverNotificationOutboxBatchMarksSent(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	delivery := &fakeNotificationDelivery{}
	processed, err := deliverNotificationOutboxBatch(context.Background(), db, delivery.deliver, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed = %d, want 1", processed)
	}
	if len(delivery.delivered) != 1 {
		t.Fatalf("delivered = %d, want 1", len(delivery.delivered))
	}

	var item models.NotificationOutbox
	if err := db.First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.Status != NotificationOutboxStatusPublished || item.PublishedAt == nil || item.LeaseUntil != nil {
		t.Fatalf("outbox item after publish = %+v, want sent with published_at", item)
	}
}

func TestDeliverNotificationOutboxBatchRetriesTemporaryFailure(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	delivery := &fakeNotificationDelivery{err: errors.New("notifications service unavailable")}
	processed, err := deliverNotificationOutboxBatch(context.Background(), db, delivery.deliver, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed = %d, want 1", processed)
	}

	var item models.NotificationOutbox
	if err := db.First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.Status != NotificationOutboxStatusFailed || item.Attempts != 1 || item.LastError == "" || item.LeaseUntil != nil {
		t.Fatalf("outbox item after failure = %+v, want failed attempt", item)
	}
	if !item.NextAttemptAt.After(time.Now()) {
		t.Fatalf("next_attempt_at = %s, want future retry", item.NextAttemptAt)
	}
}

func newNotificationOutboxTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.NotificationOutbox{}); err != nil {
		t.Fatal(err)
	}
	return db
}
