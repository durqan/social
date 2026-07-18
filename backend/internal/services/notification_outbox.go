package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/rabbit"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	NotificationOutboxStatusPending         = "pending"
	NotificationOutboxStatusPublishing      = "publishing"
	NotificationOutboxStatusPublished       = "published"
	NotificationOutboxStatusSent            = NotificationOutboxStatusPublished
	NotificationOutboxStatusFailed          = "failed"
	NotificationOutboxStatusPermanentFailed = "permanent_failed"

	notificationOutboxMaxAttempts = 12
	notificationOutboxBatchSize   = 50
	notificationOutboxPollEvery   = 2 * time.Second
	notificationOutboxLease       = 30 * time.Second
)

type NotificationPublisher interface {
	PublishNotification(ctx context.Context, req dto.CreateNotificationReq) error
}

type rabbitNotificationPublisher struct{}

func (rabbitNotificationPublisher) PublishNotification(ctx context.Context, req dto.CreateNotificationReq) error {
	return rabbit.PublishNotificationContext(ctx, req)
}

func EnqueueNotificationOutbox(tx *gorm.DB, req dto.CreateNotificationReq) error {
	req.Action = notificationOutboxAction(req.Action)
	if req.Action == "create" && req.RecipientID == req.ActorID {
		return nil
	}

	now := time.Now()
	dedupeKey := NotificationOutboxDedupeKey(req)
	if req.Action != "create" {
		dedupeKey = notificationOutboxDedupeKeyWithSuffix(req, now.UnixNano())
	}
	item := models.NotificationOutbox{
		Action:         req.Action,
		RecipientID:    req.RecipientID,
		ActorID:        req.ActorID,
		Type:           req.Type,
		EntityID:       req.EntityID,
		CallID:         strings.TrimSpace(req.CallID),
		ConversationID: req.ConversationID,
		CallType:       req.CallType,
		DedupeKey:      dedupeKey,
		Status:         NotificationOutboxStatusPending,
		NextAttemptAt:  now,
	}

	return tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedupe_key"}},
		DoNothing: true,
	}).Create(&item).Error
}

func NotificationOutboxDedupeKey(req dto.CreateNotificationReq) string {
	return notificationOutboxDedupeKeyWithSuffix(req, 0)
}

func notificationOutboxDedupeKeyWithSuffix(req dto.CreateNotificationReq, suffix int64) string {
	raw := fmt.Sprintf(
		"action:%s|recipient:%d|actor:%d|type:%s|entity:%d|call:%s|conversation:%d|suffix:%d",
		notificationOutboxAction(req.Action),
		req.RecipientID,
		req.ActorID,
		req.Type,
		req.EntityID,
		strings.TrimSpace(req.CallID),
		req.ConversationID,
		suffix,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func StartNotificationOutboxPublisher(db *gorm.DB) {
	go runNotificationOutboxPublisher(context.Background(), db, rabbitNotificationPublisher{})
}

func runNotificationOutboxPublisher(ctx context.Context, db *gorm.DB, publisher NotificationPublisher) {
	ticker := time.NewTicker(notificationOutboxPollEvery)
	defer ticker.Stop()

	for {
		published, err := PublishNotificationOutboxBatch(ctx, db, publisher, notificationOutboxBatchSize)
		if err != nil {
			log.Printf("notification outbox batch failed: error=%v", err)
		}
		if published > 0 {
			log.Printf("notification outbox batch processed: count=%d", published)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func PublishNotificationOutboxBatch(ctx context.Context, db *gorm.DB, publisher NotificationPublisher, limit int) (int, error) {
	if limit <= 0 {
		limit = notificationOutboxBatchSize
	}

	items, err := claimNotificationOutboxBatch(ctx, db, limit, time.Now())
	if err != nil {
		return 0, err
	}

	var firstFinalizeError error
	for _, item := range items {
		publishErr := publisher.PublishNotification(ctx, notificationOutboxRequest(item))
		if err := finalizeNotificationOutboxPublish(ctx, db, item, publishErr); err != nil && firstFinalizeError == nil {
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

func finalizeNotificationOutboxPublish(ctx context.Context, db *gorm.DB, item models.NotificationOutbox, cause error) error {
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
		if item.Attempts >= notificationOutboxMaxAttempts {
			status = NotificationOutboxStatusPermanentFailed
		}
		updates["status"] = status
		updates["last_error"] = truncateNotificationOutboxError(cause)
		updates["next_attempt_at"] = now.Add(notificationOutboxBackoff(item.Attempts))
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

func notificationOutboxRequest(item models.NotificationOutbox) dto.CreateNotificationReq {
	return dto.CreateNotificationReq{
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

func notificationOutboxBackoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	delay := time.Second * time.Duration(1<<(attempts-1))
	maxDelay := time.Minute
	if delay > maxDelay {
		return maxDelay
	}
	return delay
}

func notificationOutboxAction(action string) string {
	action = strings.TrimSpace(action)
	if action == "" {
		return "create"
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
