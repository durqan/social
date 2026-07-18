package services

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"tester/internal/cache"
	"tester/internal/models"

	"gorm.io/gorm"
)

const messageUpdateChannel = "message_updates"

type MessageUpdatePayload struct {
	MessageID uint `json:"message_id"`
}

func PublishMessageUpdate(ctx context.Context, messageID uint) {
	if cache.Redis == nil || messageID == 0 {
		return
	}
	body, err := json.Marshal(MessageUpdatePayload{MessageID: messageID})
	if err != nil {
		return
	}
	if err := cache.Redis.Client.Publish(ctx, messageUpdateChannel, body).Err(); err != nil {
		log.Printf("failed to publish message update: %v", err)
	}
}

func StartMessageUpdateListener(ctx context.Context, db *gorm.DB, broadcast func(context.Context, models.Message)) <-chan struct{} {
	done := make(chan struct{})
	if cache.Redis == nil || db == nil || broadcast == nil {
		close(done)
		return done
	}

	go func() {
		defer close(done)
		for {
			if err := runMessageUpdateListener(ctx, db, broadcast); err != nil && ctx.Err() == nil {
				log.Printf("message update listener stopped: %v", err)
				timer := time.NewTimer(2 * time.Second)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
			if ctx.Err() != nil {
				return
			}
		}
	}()
	return done
}

func runMessageUpdateListener(ctx context.Context, db *gorm.DB, broadcast func(context.Context, models.Message)) error {
	pubsub := cache.Redis.Client.Subscribe(ctx, messageUpdateChannel)
	defer pubsub.Close()

	for {
		msg, err := pubsub.ReceiveMessage(ctx)
		if err != nil {
			return err
		}
		var payload MessageUpdatePayload
		if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
			continue
		}
		message, err := LoadMessage(db, payload.MessageID)
		if err != nil {
			continue
		}
		broadcast(ctx, message)
	}
}
