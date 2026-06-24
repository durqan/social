package services

import (
	"context"
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
	NotificationOutboxStatusSent            = "sent"
	NotificationOutboxStatusFailed          = "failed"
	NotificationOutboxStatusPermanentFailed = "permanent_failed"

	notificationOutboxMaxAttempts = 12
	notificationOutboxBatchSize   = 50
	notificationOutboxPollEvery   = 2 * time.Second
)

type NotificationPublisher interface {
	PublishNotification(req dto.CreateNotificationReq) error
}

type rabbitNotificationPublisher struct{}

func (rabbitNotificationPublisher) PublishNotification(req dto.CreateNotificationReq) error {
	return rabbit.PublishNotification(req)
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

	now := time.Now()
	processed := 0
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var items []models.NotificationOutbox
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status IN ? AND next_attempt_at <= ? AND attempts < ?",
				[]string{NotificationOutboxStatusPending, NotificationOutboxStatusFailed},
				now,
				notificationOutboxMaxAttempts,
			).
			Order("next_attempt_at ASC, id ASC").
			Limit(limit).
			Find(&items).Error; err != nil {
			return err
		}

		for _, item := range items {
			processed++
			req := notificationOutboxRequest(item)
			if err := publisher.PublishNotification(req); err != nil {
				if updateErr := markNotificationOutboxFailed(tx, item, err); updateErr != nil {
					return updateErr
				}
				continue
			}

			publishedAt := time.Now()
			if err := tx.Model(&models.NotificationOutbox{}).
				Where("id = ?", item.ID).
				Updates(map[string]interface{}{
					"status":       NotificationOutboxStatusSent,
					"published_at": &publishedAt,
					"last_error":   "",
					"updated_at":   publishedAt,
				}).Error; err != nil {
				return err
			}
		}

		return nil
	})

	return processed, err
}

func markNotificationOutboxFailed(tx *gorm.DB, item models.NotificationOutbox, cause error) error {
	attempts := item.Attempts + 1
	status := NotificationOutboxStatusFailed
	if attempts >= notificationOutboxMaxAttempts {
		status = NotificationOutboxStatusPermanentFailed
	}

	nextAttemptAt := time.Now().Add(notificationOutboxBackoff(attempts))
	return tx.Model(&models.NotificationOutbox{}).
		Where("id = ?", item.ID).
		Updates(map[string]interface{}{
			"status":          status,
			"attempts":        attempts,
			"last_error":      truncateNotificationOutboxError(cause),
			"next_attempt_at": nextAttemptAt,
			"updated_at":      time.Now(),
		}).Error
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
