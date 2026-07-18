package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"tester/internal/models"
	"tester/internal/notifications"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	NotificationOutboxStatusPending         = "pending"
	NotificationOutboxStatusPublishing      = "publishing"
	NotificationOutboxStatusPublished       = "published"
	NotificationOutboxStatusFailed          = "failed"
	NotificationOutboxStatusPermanentFailed = "permanent_failed"
	NotificationOutboxStatusExhausted       = "exhausted"

	notificationOutboxMaxAttempts = 12
	notificationOutboxBatchSize   = 1
	notificationOutboxPollEvery   = 2 * time.Second
	notificationOutboxLease       = 45 * time.Second
	notificationDeliveryTimeout   = 30 * time.Second
)

type notificationDeliveryFunc func(context.Context, notifications.Job) error

func EnqueueNotificationOutbox(tx *gorm.DB, job notifications.Job) error {
	job.Action = notificationOutboxAction(job.Action)
	if job.Action == notifications.ActionCreate && job.RecipientID == job.ActorID {
		return nil
	}

	now := time.Now()
	dedupeKey := NotificationOutboxDedupeKey(job)
	if job.Action != notifications.ActionCreate {
		dedupeKey = notificationOutboxDedupeKeyWithSuffix(job, now.UnixNano())
	}
	item := models.NotificationOutbox{
		Action:         job.Action,
		RecipientID:    job.RecipientID,
		ActorID:        job.ActorID,
		Type:           job.Type,
		EntityID:       job.EntityID,
		CallID:         strings.TrimSpace(job.CallID),
		ConversationID: job.ConversationID,
		CallType:       job.CallType,
		DedupeKey:      dedupeKey,
		Status:         NotificationOutboxStatusPending,
		NextAttemptAt:  now,
	}

	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedupe_key"}},
		DoNothing: true,
	}).Create(&item).Error
}

func NotificationOutboxDedupeKey(job notifications.Job) string {
	return notificationOutboxDedupeKeyWithSuffix(job, 0)
}

func notificationOutboxDedupeKeyWithSuffix(job notifications.Job, suffix int64) string {
	raw := fmt.Sprintf(
		"action:%s|recipient:%d|actor:%d|type:%s|entity:%d|call:%s|conversation:%d|suffix:%d",
		notificationOutboxAction(job.Action),
		job.RecipientID,
		job.ActorID,
		job.Type,
		job.EntityID,
		strings.TrimSpace(job.CallID),
		job.ConversationID,
		suffix,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func StartNotificationOutboxWorker(
	ctx context.Context,
	db *gorm.DB,
	service *notifications.Service,
) <-chan struct{} {
	done := make(chan struct{})
	if service == nil {
		log.Print("notification outbox worker disabled: notification service is nil")
		close(done)
		return done
	}

	go func() {
		defer close(done)
		runNotificationOutboxWorker(ctx, db, service.Process)
	}()
	return done
}

func runNotificationOutboxWorker(ctx context.Context, db *gorm.DB, deliver notificationDeliveryFunc) {
	ticker := time.NewTicker(notificationOutboxPollEvery)
	defer ticker.Stop()

	for {
		delivered, err := deliverNotificationOutboxBatch(ctx, db, deliver, notificationOutboxBatchSize)
		if err != nil {
			log.Printf("notification outbox batch failed: error=%v", err)
		}
		if delivered > 0 {
			log.Printf("notification outbox batch processed: count=%d", delivered)
			if ctx.Err() != nil {
				return
			}
			continue
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func deliverNotificationOutboxBatch(ctx context.Context, db *gorm.DB, deliver notificationDeliveryFunc, limit int) (int, error) {
	if limit <= 0 {
		limit = notificationOutboxBatchSize
	}

	items, err := claimNotificationOutboxBatch(ctx, db, limit, time.Now())
	if err != nil {
		return 0, err
	}

	var firstFinalizeError error
	for _, item := range items {
		deliveryCtx, cancel := context.WithTimeout(ctx, notificationDeliveryTimeout)
		deliveryErr := deliver(deliveryCtx, notificationOutboxJob(item))
		cancel()
		if deliveryErr != nil {
			log.Printf(
				"notification delivery failed: outbox_id=%d attempt=%d permanent=%t error=%v",
				item.ID,
				item.Attempts,
				errors.Is(deliveryErr, notifications.ErrPermanentDelivery),
				deliveryErr,
			)
		}
		if err := finalizeNotificationOutboxDelivery(ctx, db, item, deliveryErr); err != nil && firstFinalizeError == nil {
			firstFinalizeError = err
		}
	}
	return len(items), firstFinalizeError
}

func claimNotificationOutboxBatch(ctx context.Context, db *gorm.DB, limit int, now time.Time) ([]models.NotificationOutbox, error) {
	leaseToken, err := notificationOutboxLeaseToken()
	if err != nil {
		return nil, err
	}
	leaseUntil := now.Add(notificationOutboxLease)
	var claimed []models.NotificationOutbox
	err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.NotificationOutbox{}).
			Where(`status = ? AND attempts >= ? AND (lease_until IS NULL OR lease_until <= ?)`,
				NotificationOutboxStatusPublishing,
				notificationOutboxMaxAttempts,
				now,
			).
			Updates(map[string]interface{}{
				"status":      NotificationOutboxStatusExhausted,
				"last_error":  "delivery lease expired after maximum attempts",
				"lease_token": "",
				"lease_until": nil,
				"updated_at":  now,
			}).Error; err != nil {
			return err
		}

		var items []models.NotificationOutbox
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where(`attempts < ? AND next_attempt_at <= ? AND (
				status IN ? OR (status = ? AND (lease_until IS NULL OR lease_until <= ?))
			)`,
				notificationOutboxMaxAttempts,
				now,
				[]string{NotificationOutboxStatusPending, NotificationOutboxStatusFailed},
				NotificationOutboxStatusPublishing,
				now,
			).
			Order("next_attempt_at ASC, id ASC").
			Limit(limit).
			Find(&items).Error; err != nil {
			return err
		}
		for i := range items {
			result := tx.Model(&models.NotificationOutbox{}).
				Where("id = ? AND attempts = ?", items[i].ID, items[i].Attempts).
				Updates(map[string]interface{}{
					"status":      NotificationOutboxStatusPublishing,
					"attempts":    gorm.Expr("attempts + 1"),
					"lease_token": leaseToken,
					"lease_until": &leaseUntil,
					"updated_at":  now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 1 {
				items[i].Status = NotificationOutboxStatusPublishing
				items[i].Attempts++
				items[i].LeaseToken = leaseToken
				items[i].LeaseUntil = &leaseUntil
				claimed = append(claimed, items[i])
			}
		}
		return nil
	})
	return claimed, err
}

func finalizeNotificationOutboxDelivery(ctx context.Context, db *gorm.DB, item models.NotificationOutbox, cause error) error {
	now := time.Now()
	updates := map[string]interface{}{
		"lease_token": "",
		"lease_until": nil,
		"updated_at":  now,
	}
	if cause == nil {
		updates["status"] = NotificationOutboxStatusPublished
		updates["published_at"] = &now
		updates["last_error"] = ""
	} else {
		status := NotificationOutboxStatusFailed
		if errors.Is(cause, notifications.ErrPermanentDelivery) {
			status = NotificationOutboxStatusPermanentFailed
		} else if item.Attempts >= notificationOutboxMaxAttempts {
			status = NotificationOutboxStatusExhausted
		}
		updates["status"] = status
		updates["last_error"] = truncateNotificationOutboxError(cause)
		if status == NotificationOutboxStatusFailed {
			delay := notificationOutboxBackoff(item.ID, item.Attempts)
			if requested := notifications.RetryAfter(cause); requested > delay {
				delay = requested
			}
			updates["next_attempt_at"] = now.Add(delay)
		}
	}
	result := db.WithContext(ctx).Model(&models.NotificationOutbox{}).
		Where("id = ? AND status = ? AND lease_token = ?", item.ID, NotificationOutboxStatusPublishing, item.LeaseToken).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("notification outbox lease lost: id=%d", item.ID)
	}
	return nil
}

func notificationOutboxLeaseToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func notificationOutboxJob(item models.NotificationOutbox) notifications.Job {
	return notifications.Job{
		Action:         item.Action,
		RecipientID:    item.RecipientID,
		ActorID:        item.ActorID,
		Type:           item.Type,
		EntityID:       item.EntityID,
		CallID:         item.CallID,
		ConversationID: item.ConversationID,
		CallType:       item.CallType,
	}
}

func notificationOutboxBackoff(itemID uint, attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	delay := time.Second * time.Duration(1<<(attempts-1))
	maxDelay := time.Minute
	if delay > maxDelay {
		delay = maxDelay
	}

	seed := sha256.Sum256([]byte(fmt.Sprintf("%d:%d", itemID, attempts)))
	sample := uint64(binary.BigEndian.Uint16(seed[:2]))
	spread := delay / 5
	return delay - spread + time.Duration(uint64(spread)*sample/65535)
}

func notificationOutboxAction(action string) string {
	action = strings.TrimSpace(action)
	if action == "" {
		return notifications.ActionCreate
	}
	return action
}

func truncateNotificationOutboxError(cause error) string {
	if cause == nil {
		return ""
	}
	message := cause.Error()
	if len(message) <= 1000 {
		return message
	}
	return message[:1000]
}
