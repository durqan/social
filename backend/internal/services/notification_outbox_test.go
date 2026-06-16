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

func (p *fakeNotificationPublisher) PublishNotification(req dto.CreateNotificationReq) error {
	if p.err != nil {
		return p.err
	}
	p.published = append(p.published, req)
	return nil
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
	if item.Status != NotificationOutboxStatusSent || item.PublishedAt == nil {
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
	if item.Status != NotificationOutboxStatusFailed || item.Attempts != 1 || item.LastError == "" {
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
