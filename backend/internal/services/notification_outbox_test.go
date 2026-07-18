package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"tester/internal/dto"
	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeNotificationPublisher struct {
	err       error
	published []dto.CreateNotificationReq
}

func (p *fakeNotificationPublisher) PublishNotification(_ context.Context, req dto.CreateNotificationReq) error {
	if p.err != nil {
		return p.err
	}
	p.published = append(p.published, req)
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

func TestPublishNotificationOutboxBatchMarksSent(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	publisher := &fakeNotificationPublisher{}
	processed, err := PublishNotificationOutboxBatch(context.Background(), db, publisher, 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 {
		t.Fatalf("processed = %d, want 1", processed)
	}
	if len(publisher.published) != 1 {
		t.Fatalf("published = %d, want 1", len(publisher.published))
	}

	var item models.NotificationOutbox
	if err := db.First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.Status != NotificationOutboxStatusPublished || item.PublishedAt == nil || item.LeaseUntil != nil {
		t.Fatalf("outbox item after publish = %+v, want sent with published_at", item)
	}
}

func TestPublishNotificationOutboxBatchRetriesTemporaryFailure(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, dto.CreateNotificationReq{
		RecipientID: 10,
		ActorID:     20,
		Type:        dto.NotificationTypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	publisher := &fakeNotificationPublisher{err: errors.New("rabbit down")}
	processed, err := PublishNotificationOutboxBatch(context.Background(), db, publisher, 10)
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
