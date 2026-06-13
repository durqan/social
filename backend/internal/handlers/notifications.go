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
		Action:      "create",
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

func publishMessageNotification(recipientID, actorID uint, messageID uint) {
	if recipientID == actorID {
		return
	}
	if clients.hasActiveConversation(recipientID, actorID) {
		return
	}

	req := dto.CreateNotificationReq{
		Action:         "create",
		RecipientID:    recipientID,
		ActorID:        actorID,
		Type:           dto.NotificationTypeMessage,
		EntityID:       messageID,
		ConversationID: actorID,
	}

	if err := rabbit.PublishNotification(req); err != nil {
		log.Printf(
			"failed to publish message notification: recipient_id=%d actor_id=%d message_id=%d conversation_id=%d error=%v",
			req.RecipientID,
			req.ActorID,
			req.EntityID,
			req.ConversationID,
			err,
		)
	}
}

func publishMessageReadSync(readerID uint, conversationID uint) {
	if readerID == 0 || conversationID == 0 {
		return
	}

	req := dto.CreateNotificationReq{
		Action:         "mark_conversation_read",
		RecipientID:    readerID,
		ActorID:        conversationID,
		Type:           dto.NotificationTypeMessage,
		ConversationID: conversationID,
	}

	if err := rabbit.PublishNotification(req); err != nil {
		log.Printf(
			"failed to publish message read sync: reader_id=%d conversation_id=%d error=%v",
			readerID,
			conversationID,
			err,
		)
	}
}

// publishIncomingCallNotification creates a push-eligible notification for an incoming call offer.
// It is called ONLY for "call:offer" events (enforced by the caller).
// Publication errors (e.g. Rabbit down) are logged but MUST NOT prevent the WS call signalling.
// If callID is empty we still publish using conversationID fallback for tag/URL (dedup will be weaker).
// See detailed rationale in ws_events.go.
func publishIncomingCallNotification(recipientID, actorID uint, callID string, conversationID uint) {
	if recipientID == actorID {
		return
	}

	if callID == "" {
		log.Printf(
			"warning: publishing incoming_call push without call_id (dedup may be weaker): caller_id=%d recipient_id=%d conversation_id=%d",
			actorID, recipientID, conversationID,
		)
	}

	req := dto.CreateNotificationReq{
		Action:         "create",
		RecipientID:    recipientID,
		ActorID:        actorID,
		Type:           dto.NotificationTypeIncomingCall,
		EntityID:       0,
		CallID:         callID,
		ConversationID: conversationID,
	}

	if err := rabbit.PublishNotification(req); err != nil {
		log.Printf(
			"error: failed to publish incoming_call notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d type=incoming_call error=%v",
			req.CallID, req.ActorID, req.RecipientID, req.ConversationID, err,
		)
		return
	}

	// Success path log (useful for debugging push delivery)
	log.Printf(
		"info: published incoming_call push notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d",
		req.CallID, req.ActorID, req.RecipientID, req.ConversationID,
	)
}
