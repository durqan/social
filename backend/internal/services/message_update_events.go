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

func StartMessageUpdateListener(db *gorm.DB, broadcast func(context.Context, models.Message)) {
	if cache.Redis == nil || db == nil || broadcast == nil {
		return
	}

	go func() {
		for {
			if err := runMessageUpdateListener(db, broadcast); err != nil {
				log.Printf("message update listener stopped: %v", err)
				time.Sleep(2 * time.Second)
			}
		}
	}()
}

func runMessageUpdateListener(db *gorm.DB, broadcast func(context.Context, models.Message)) error {
	pubsub := cache.Redis.Client.Subscribe(cache.Redis.Ctx, messageUpdateChannel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for msg := range ch {
		var payload MessageUpdatePayload
		if err := json.Unmarshal([]byte(msg.Payload), &payload); err != nil {
			continue
		}
		message, err := LoadMessage(db, payload.MessageID)
		if err != nil {
			continue
		}
		broadcast(context.Background(), message)
	}
	return nil
}
