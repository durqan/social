package handlers

import (
	"log"

	"tester/internal/dto"
	"tester/internal/services"

	"gorm.io/gorm"
)

func enqueueNotification(db *gorm.DB, recipientID, actorID uint, notificationType string, entityID uint) error {
	if recipientID == actorID {
		return nil
	}

	req := dto.CreateNotificationReq{
		Action:      "create",
		RecipientID: recipientID,
		ActorID:     actorID,
		Type:        notificationType,
		EntityID:    entityID,
	}

	if err := services.EnqueueNotificationOutbox(db, req); err != nil {
		log.Printf(
			"failed to enqueue notification outbox: recipient_id=%d actor_id=%d type=%s entity_id=%d error=%v",
			req.RecipientID,
			req.ActorID,
			req.Type,
			req.EntityID,
			err,
		)
		return err
	}
	return nil
}

func enqueueMessageReadSync(db *gorm.DB, readerID uint, conversationID uint) {
	if db == nil || readerID == 0 || conversationID == 0 {
		return
	}

	req := dto.CreateNotificationReq{
		Action:         "mark_conversation_read",
		RecipientID:    readerID,
		ActorID:        conversationID,
		Type:           dto.NotificationTypeMessage,
		ConversationID: conversationID,
	}

	if err := services.EnqueueNotificationOutbox(db, req); err != nil {
		log.Printf(
			"failed to enqueue message read sync: reader_id=%d conversation_id=%d error=%v",
			readerID,
			conversationID,
			err,
		)
	}
}

// enqueueIncomingCallNotification creates a push-eligible notification for an incoming call offer.
// It is called ONLY for "call:offer" events (enforced by the caller).
// Publication errors (e.g. Rabbit down) are logged but MUST NOT prevent the WS call signalling.
// If callID is empty we still publish using conversationID fallback for tag/URL (dedup will be weaker).
// See detailed rationale in ws_events.go.
func enqueueIncomingCallNotification(db *gorm.DB, recipientID, actorID uint, callID string, conversationID uint, callType string) {
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
		CallType:       callType,
	}

	if err := services.EnqueueNotificationOutbox(db, req); err != nil {
		log.Printf(
			"error: failed to enqueue incoming_call notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d type=incoming_call error=%v",
			req.CallID, req.ActorID, req.RecipientID, req.ConversationID, err,
		)
		return
	}

	log.Printf(
		"info: enqueued incoming_call notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d",
		req.CallID, req.ActorID, req.RecipientID, req.ConversationID,
	)
}

func enqueueCallStateNotification(db *gorm.DB, recipientID, actorID uint, notificationType string, callID string, conversationID uint, callType string) {
	if db == nil || recipientID == 0 || actorID == 0 || recipientID == actorID || callID == "" {
		return
	}

	req := dto.CreateNotificationReq{
		Action:         "create",
		RecipientID:    recipientID,
		ActorID:        actorID,
		Type:           notificationType,
		EntityID:       0,
		CallID:         callID,
		ConversationID: conversationID,
		CallType:       callType,
	}

	if err := services.EnqueueNotificationOutbox(db, req); err != nil {
		log.Printf(
			"failed to enqueue call state notification: call_id=%s type=%s recipient_id=%d actor_id=%d error=%v",
			callID,
			notificationType,
			recipientID,
			actorID,
			err,
		)
	}
}
