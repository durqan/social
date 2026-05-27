package handlers

import (
	"log"

	"tester/internal/dto"
	"tester/internal/rabbit"
)

func publishNotification(recipientID, actorID uint, notificationType string, entityID uint) {
	if recipientID == actorID {
		return
	}

	req := dto.CreateNotificationReq{
		RecipientID: recipientID,
		ActorID:     actorID,
		Type:        notificationType,
		EntityID:    entityID,
	}

	if err := rabbit.PublishNotification(req); err != nil {
		log.Printf(
			"failed to publish notification: recipient_id=%d actor_id=%d type=%s entity_id=%d error=%v",
			req.RecipientID,
			req.ActorID,
			req.Type,
			req.EntityID,
			err,
		)
	}
}
