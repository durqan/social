package services

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/notifications"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type fakeNotificationDelivery struct {
	err       error
	delivered []notifications.Job
}

type retryAfterDeliveryError struct {
	delay time.Duration
}

func (e retryAfterDeliveryError) Error() string {
	return "provider requested retry delay"
}

func (e retryAfterDeliveryError) RetryAfter() time.Duration {
	return e.delay
}

func (d *fakeNotificationDelivery) deliver(_ context.Context, job notifications.Job) error {
	if d.err != nil {
		return d.err
	}
	d.delivered = append(d.delivered, job)
	return nil
}

func TestClaimNotificationOutboxBatchMarksPublishing(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, notifications.Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        notifications.TypeFriendRequest,
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

func TestNotificationOutboxWorkerLeaseCoversOneDelivery(t *testing.T) {
	if notificationOutboxBatchSize != 1 {
		t.Fatalf("runtime batch size = %d, want one sequential delivery per lease", notificationOutboxBatchSize)
	}
	if notificationDeliveryTimeout >= notificationOutboxLease {
		t.Fatalf(
			"delivery timeout %s must be shorter than lease %s",
			notificationDeliveryTimeout,
			notificationOutboxLease,
		)
	}
}

func TestClaimNotificationOutboxBatchReclaimsExpiredLease(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	now := time.Now()
	expired := now.Add(-time.Second)
	item := models.NotificationOutbox{
		RecipientID:   10,
		ActorID:       20,
		Type:          notifications.TypeFriendRequest,
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

func TestClaimNotificationOutboxBatchExhaustsExpiredFinalLease(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	now := time.Now()
	expired := now.Add(-time.Second)
	item := models.NotificationOutbox{
		RecipientID:   10,
		ActorID:       20,
		Type:          notifications.TypeFriendRequest,
		DedupeKey:     "expired-final-lease",
		Status:        NotificationOutboxStatusPublishing,
		Attempts:      notificationOutboxMaxAttempts,
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
	if len(items) != 0 {
		t.Fatalf("claimed items = %+v, want final expired lease exhausted without another delivery", items)
	}
	var reloaded models.NotificationOutbox
	if err := db.First(&reloaded, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reloaded.Status != NotificationOutboxStatusExhausted || reloaded.LeaseUntil != nil || reloaded.LeaseToken != "" {
		t.Fatalf("expired final lease = %+v, want exhausted and released", reloaded)
	}
}

func TestDeliverNotificationOutboxBatchMarksSent(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, notifications.Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        notifications.TypeFriendRequest,
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
	if err := EnqueueNotificationOutbox(db, notifications.Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        notifications.TypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	delivery := &fakeNotificationDelivery{err: errors.New("FCM temporarily unavailable")}
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

func TestDeliverNotificationOutboxBatchStopsPermanentFailure(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, notifications.Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        notifications.TypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	delivery := &fakeNotificationDelivery{err: fmt.Errorf(
		"%w: invalid FCM request",
		notifications.ErrPermanentDelivery,
	)}
	if _, err := deliverNotificationOutboxBatch(
		context.Background(),
		db,
		delivery.deliver,
		10,
	); err != nil {
		t.Fatal(err)
	}

	var item models.NotificationOutbox
	if err := db.First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.Status != NotificationOutboxStatusPermanentFailed ||
		item.Attempts != 1 ||
		item.LastError == "" {
		t.Fatalf("outbox item after permanent failure = %+v", item)
	}
}

func TestDeliverNotificationOutboxBatchHonorsRetryAfter(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	if err := EnqueueNotificationOutbox(db, notifications.Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        notifications.TypeFriendRequest,
		EntityID:    20,
	}); err != nil {
		t.Fatal(err)
	}

	started := time.Now()
	delivery := &fakeNotificationDelivery{err: retryAfterDeliveryError{delay: 2 * time.Minute}}
	if _, err := deliverNotificationOutboxBatch(context.Background(), db, delivery.deliver, 10); err != nil {
		t.Fatal(err)
	}

	var item models.NotificationOutbox
	if err := db.First(&item).Error; err != nil {
		t.Fatal(err)
	}
	if item.NextAttemptAt.Before(started.Add(2 * time.Minute)) {
		t.Fatalf("next_attempt_at = %s, want Retry-After minimum", item.NextAttemptAt)
	}
}

func TestFinalizeNotificationOutboxExhaustsTransientFailure(t *testing.T) {
	db := newNotificationOutboxTestDB(t)
	item := models.NotificationOutbox{
		RecipientID:   10,
		ActorID:       20,
		Type:          notifications.TypeFriendRequest,
		DedupeKey:     "exhausted-transient",
		Status:        NotificationOutboxStatusPublishing,
		Attempts:      notificationOutboxMaxAttempts,
		NextAttemptAt: time.Now(),
		LeaseToken:    "worker",
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	if err := finalizeNotificationOutboxDelivery(
		context.Background(),
		db,
		item,
		errors.New("temporary failure"),
	); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&item, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if item.Status != NotificationOutboxStatusExhausted {
		t.Fatalf("status = %q, want %q", item.Status, NotificationOutboxStatusExhausted)
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
