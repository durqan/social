package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"tester/internal/middleware"
	"tester/internal/models"
	"tester/internal/notifications"
	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func handleWebSocketMessage(ctx context.Context, userID uint, client *websocketClient, wsMsg WSMessage) {
	if _, err := services.MarkUserActivity(dbInstance, userID); err != nil {
		log.Println("failed to update websocket activity:", err)
	}

	switch wsMsg.Type {
	case "message:send":
		handleWebSocketSendMessage(ctx, userID, wsMsg.Payload)
	case "typing:start", "typing:stop":
		handleWebSocketTyping(ctx, userID, wsMsg.Type, wsMsg.Payload)
	case "message:read":
		handleWebSocketReadReceipt(ctx, userID, wsMsg.Payload)
	case "conversation:active":
		handleActiveConversation(userID, client, wsMsg.Payload)
	case "conversation:inactive":
		if client != nil {
			clients.setActiveConversation(userID, client, 0)
		}
	case "call:heartbeat":
		toID, ok := authorizeRealtimePeerEvent(userID, wsMsg.Payload, wsMsg.Type)
		if !ok {
			return
		}
		handleCallHeartbeat(userID, toID, wsMsg.Payload)
	default:
		log.Println("Unknown websocket event:", wsMsg.Type)
	}
}

func handleActiveConversation(userID uint, client *websocketClient, rawPayload json.RawMessage) {
	if client == nil {
		return
	}

	var payload struct {
		ConversationID uint `json:"conversation_id"`
	}
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Println("Invalid active conversation payload:", err)
		return
	}

	clients.setActiveConversation(userID, client, payload.ConversationID)
}

func handleWebSocketSendMessage(ctx context.Context, userID uint, rawPayload json.RawMessage) {
	if !canSendWebSocketMessage(ctx, userID) {
		return
	}

	var payload struct {
		ToID              uint                              `json:"to_id"`
		Content           string                            `json:"content"`
		Attachments       []services.MessageAttachmentInput `json:"attachments"`
		ReplyToMessageID  *uint                             `json:"replyToMessageId"`
		EncryptionVersion int                               `json:"encryption_version"`
		Ciphertext        string                            `json:"ciphertext"`
		Nonce             string                            `json:"nonce"`
	}

	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Println("Invalid message payload:", err)
		return
	}

	attachments, err := services.NormalizeMessageAttachments(payload.Attachments, userID)
	if err != nil {
		log.Println("Invalid attachments:", err)
		return
	}

	if payload.ToID == 0 {
		log.Println("Invalid message data")
		return
	}

	fullMessage, err := services.SendMessage(dbInstance, userID, payload.ToID, payload.Content, attachments, payload.ReplyToMessageID, requestEncryption(payload.EncryptionVersion, payload.Ciphertext, payload.Nonce))
	if errors.Is(err, services.ErrMessageContentRequired) {
		log.Println("Invalid message data")
		return
	}
	if errors.Is(err, services.ErrMessageContentTooLong) {
		sendWebSocketError(ctx, userID, "message content must be 1000 characters or less")
		return
	}
	if errors.Is(err, services.ErrMessageNotFriends) {
		sendWebSocketError(ctx, userID, "can only message accepted friends")
		return
	}
	if errors.Is(err, services.ErrMessageInvalidReply) {
		sendWebSocketError(ctx, userID, "reply message must belong to this conversation")
		return
	}
	if errors.Is(err, services.ErrMessageInvalidEncryption) {
		sendWebSocketError(ctx, userID, "invalid encrypted message payload")
		return
	}
	if errors.Is(err, services.ErrMessageEncryptionUnavailable) {
		sendWebSocketError(ctx, userID, "message encryption is not configured")
		return
	}
	if err != nil {
		log.Println("Failed to save message:", err)
		return
	}

	broadcastNewMessage(ctx, fullMessage)
}

func broadcastNewMessage(ctx context.Context, message models.Message) {
	messageBytes, err := json.Marshal(gin.H{
		"type":    "message:new",
		"payload": services.WithPrivateAttachmentURLs(message),
	})
	if err != nil {
		log.Println("Failed to marshal message:", err)
		return
	}

	for _, toConn := range clients.getAll(message.ToID) {
		if err := toConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message to recipient:", err)
		}
	}

	for _, fromConn := range clients.getAll(message.FromID) {
		if err := fromConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message to sender:", err)
		}
	}

	broadcastConversationDeltas(ctx, dbInstance, message.FromID, message.ToID, nil)
}

func broadcastConversationDeltas(ctx context.Context, db *gorm.DB, firstUserID, secondUserID uint, onlyRecipients map[uint]struct{}) {
	if db == nil || firstUserID == 0 || secondUserID == 0 || firstUserID == secondUserID {
		return
	}

	deltas, err := services.GetConversationDeltasForPair(db, firstUserID, secondUserID)
	if err != nil {
		log.Printf("failed to build conversation delta: first_user_id=%d second_user_id=%d error=%v", firstUserID, secondUserID, err)
		return
	}
	for _, delta := range deltas {
		if onlyRecipients != nil {
			if _, ok := onlyRecipients[delta.RecipientUserID]; !ok {
				continue
			}
		}
		deltaBytes, err := json.Marshal(gin.H{
			"type":    "conversation:delta",
			"payload": delta,
		})
		if err != nil {
			log.Println("failed to marshal conversation delta:", err)
			continue
		}
		for _, conn := range clients.getAll(delta.RecipientUserID) {
			if err := conn.write(ctx, deltaBytes); err != nil {
				log.Println("failed to send conversation delta:", err)
			}
		}
	}
}

func BroadcastMessageUpdate(ctx context.Context, message models.Message) {
	messageBytes, err := json.Marshal(gin.H{
		"type":    "message:update",
		"payload": services.WithPrivateAttachmentURLs(message),
	})
	if err != nil {
		log.Println("Failed to marshal message update:", err)
		return
	}

	for _, toConn := range clients.getAll(message.ToID) {
		if err := toConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message update to recipient:", err)
		}
	}

	for _, fromConn := range clients.getAll(message.FromID) {
		if err := fromConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message update to sender:", err)
		}
	}

	broadcastConversationDeltaForLastMessage(ctx, dbInstance, message)
}

func broadcastConversationDeltaForLastMessage(ctx context.Context, db *gorm.DB, message models.Message) {
	owners, err := repository.GetConversationHeadOwnersByLastMessageIDs(db, []uint{message.ID})
	if err != nil {
		log.Printf("failed to identify conversation delta recipients: message_id=%d error=%v", message.ID, err)
		return
	}
	recipients := make(map[uint]struct{}, len(owners))
	for _, owner := range owners {
		recipients[owner.UserID] = struct{}{}
	}
	if len(recipients) > 0 {
		broadcastConversationDeltas(ctx, db, message.FromID, message.ToID, recipients)
	}
}

func broadcastConversationDeltasAfterDelete(
	ctx context.Context,
	db *gorm.DB,
	messages []models.Message,
	lastMessageOwners []repository.ConversationHeadOwner,
	onlyUserID uint,
) {
	type pair struct {
		first  uint
		second uint
	}
	recipientsByPair := make(map[pair]map[uint]struct{})
	addRecipient := func(firstUserID, secondUserID, recipientUserID uint) {
		if onlyUserID != 0 && recipientUserID != onlyUserID {
			return
		}
		if firstUserID > secondUserID {
			firstUserID, secondUserID = secondUserID, firstUserID
		}
		key := pair{first: firstUserID, second: secondUserID}
		if recipientsByPair[key] == nil {
			recipientsByPair[key] = make(map[uint]struct{})
		}
		recipientsByPair[key][recipientUserID] = struct{}{}
	}

	for _, owner := range lastMessageOwners {
		addRecipient(owner.UserID, owner.PeerUserID, owner.UserID)
	}
	// Deleting an unread non-last message does not move the row, but it does
	// change its authoritative unread projection and therefore needs a delta.
	for _, message := range messages {
		if !message.IsRead {
			addRecipient(message.FromID, message.ToID, message.ToID)
		}
	}

	for key, recipients := range recipientsByPair {
		broadcastConversationDeltas(ctx, db, key.first, key.second, recipients)
	}
}

func StartMessageUpdateSubscriber(ctx context.Context, database *gorm.DB) <-chan struct{} {
	return services.StartMessageUpdateListener(ctx, database, BroadcastMessageUpdate)
}

func canSendWebSocketMessage(ctx context.Context, userID uint) bool {
	user, err := repository.GetUserById(dbInstance, userID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Println("Failed to check email verification:", err)
		}
		sendWebSocketError(ctx, userID, "internal server error")
		return false
	}

	if !user.IsEmailVerified {
		sendWebSocketError(ctx, userID, middleware.EmailVerificationRequiredMessage)
		return false
	}

	identity := fmt.Sprintf("user:%d", userID)
	if !middleware.AllowRateLimit(identity, "message:send", 30, 10*time.Minute) {
		sendWebSocketError(ctx, userID, "too many requests")
		return false
	}

	return true
}

func sendWebSocketError(ctx context.Context, userID uint, message string) {
	messageBytes, err := json.Marshal(gin.H{
		"type": "message:error",
		"payload": gin.H{
			"error": message,
		},
	})
	if err != nil {
		log.Println("Failed to marshal websocket error:", err)
		return
	}

	for _, conn := range clients.getAll(userID) {
		if err := conn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send websocket error:", err)
		}
	}
}

func handleWebSocketTyping(ctx context.Context, userID uint, eventType string, rawPayload json.RawMessage) {
	toID, ok := authorizeRealtimePeerEvent(userID, rawPayload, eventType)
	if !ok {
		return
	}

	typingBytes, _ := json.Marshal(gin.H{
		"type": eventType,
		"payload": gin.H{
			"from_id": userID,
		},
	})

	for _, toConn := range clients.getAll(toID) {
		if err := toConn.write(ctx, typingBytes); err != nil {
			log.Println("Failed to send typing event:", err)
		}
	}
}

func handleWebSocketReadReceipt(ctx context.Context, userID uint, rawPayload json.RawMessage) {
	var payload struct {
		ToID uint `json:"to_id"`
	}

	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Println("Invalid read receipt payload:", err)
		return
	}

	if payload.ToID == 0 {
		return
	}

	affected, err := services.MarkConversationReadWithResult(dbInstance, payload.ToID, userID)
	if err != nil {
		log.Println("Failed to mark messages as read:", err)
		return
	}
	if affected == 0 {
		return
	}

	sendMessageReadReceipt(ctx, userID, payload.ToID)
	sendConversationReadSync(ctx, userID, payload.ToID)
	enqueueMessageReadSync(dbInstance, userID, payload.ToID)
	broadcastConversationDeltas(ctx, dbInstance, userID, payload.ToID, nil)
}

func sendMessageReadReceipt(ctx context.Context, readerID uint, senderID uint) {
	if senderID == 0 {
		return
	}

	receiptBytes, _ := json.Marshal(gin.H{
		"type": "message:read",
		"payload": gin.H{
			"from_id":         readerID,
			"to_id":           senderID,
			"conversation_id": senderID,
		},
	})

	for _, userID := range []uint{senderID, readerID} {
		for _, toConn := range clients.getAll(userID) {
			if err := toConn.write(ctx, receiptBytes); err != nil {
				log.Println("Failed to send read receipt:", err)
			}
		}
	}
}

func sendConversationReadSync(ctx context.Context, readerID uint, conversationID uint) {
	if readerID == 0 || conversationID == 0 {
		return
	}

	syncBytes, _ := json.Marshal(gin.H{
		"type": "conversation:read",
		"payload": gin.H{
			"reader_id":       readerID,
			"conversation_id": conversationID,
		},
	})

	for _, toConn := range clients.getAll(readerID) {
		if err := toConn.write(ctx, syncBytes); err != nil {
			log.Println("Failed to send conversation read sync:", err)
		}
	}
}

func broadcastMessageDelete(ctx context.Context, messageID uint, userIDs ...uint) {
	if messageID == 0 {
		return
	}

	deleteBytes, err := json.Marshal(gin.H{
		"type": "message:delete",
		"payload": gin.H{
			"message_id": messageID,
		},
	})
	if err != nil {
		log.Println("Failed to marshal message delete:", err)
		return
	}

	sentTo := make(map[uint]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 {
			continue
		}
		if _, exists := sentTo[userID]; exists {
			continue
		}
		sentTo[userID] = struct{}{}

		for _, toConn := range clients.getAll(userID) {
			if err := toConn.write(ctx, deleteBytes); err != nil {
				log.Println("Failed to send message delete:", err)
			}
		}
	}
}

func broadcastMessageUpdate(ctx context.Context, message models.Message) {
	updateBytes, err := json.Marshal(gin.H{
		"type":    "message:update",
		"payload": services.WithPrivateAttachmentURLs(message),
	})
	if err != nil {
		log.Println("Failed to marshal message update:", err)
		return
	}

	sentTo := make(map[uint]struct{}, 2)
	for _, userID := range []uint{message.FromID, message.ToID} {
		if userID == 0 {
			continue
		}
		if _, exists := sentTo[userID]; exists {
			continue
		}
		sentTo[userID] = struct{}{}

		for _, toConn := range clients.getAll(userID) {
			if err := toConn.write(ctx, updateBytes); err != nil {
				log.Println("Failed to send message update:", err)
			}
		}
	}

	broadcastConversationDeltaForLastMessage(ctx, dbInstance, message)
}

func broadcastMessageReactionUpdate(ctx context.Context, db *gorm.DB, message models.Message) {
	for _, userID := range []uint{message.FromID, message.ToID} {
		eventBytes, visible, err := messageReactionUpdateEvent(db, message, userID)
		if err != nil {
			log.Println("Failed to build message reaction event:", err)
			continue
		}
		if !visible {
			continue
		}
		for _, conn := range clients.getAll(userID) {
			if err := conn.write(ctx, eventBytes); err != nil {
				log.Println("Failed to send message reaction:", err)
			}
		}
	}
}

func messageReactionUpdateEvent(db *gorm.DB, message models.Message, userID uint) ([]byte, bool, error) {
	visible, err := repository.MessageVisibleToUser(db, message.ID, userID)
	if err != nil {
		return nil, false, err
	}
	if !visible {
		return nil, false, nil
	}
	summaries, err := repository.GetReactionSummaries(db, message.ID, userID)
	if err != nil {
		return nil, false, err
	}
	eventBytes, err := json.Marshal(gin.H{
		"type": "message:reaction",
		"payload": gin.H{
			"message_id":       message.ID,
			"conversation_id":  participantIDForMessage(message, userID),
			"reaction_version": message.ReactionVersion,
			"reactions":        summaries,
		},
	})
	if err != nil {
		return nil, false, err
	}
	return eventBytes, true, nil
}

func participantIDForMessage(message models.Message, userID uint) uint {
	if message.FromID == userID {
		return message.ToID
	}
	return message.FromID
}

func broadcastMessagePinned(ctx context.Context, pin *models.PinnedMessage) {
	if pin == nil {
		return
	}

	pinBytes, err := json.Marshal(gin.H{
		"type": "message_pinned",
		"payload": gin.H{
			"pinned_message": pinnedMessageResponse(pin),
		},
	})
	if err != nil {
		log.Println("Failed to marshal message pin:", err)
		return
	}

	writeToUsers(ctx, pinBytes, pin.Message.FromID, pin.Message.ToID)
}

func broadcastMessageUnpinned(ctx context.Context, conversationID, messageID uint, userIDs ...uint) {
	if conversationID == 0 {
		return
	}

	participantIDs := make([]uint, 0, len(userIDs))
	seen := make(map[uint]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		participantIDs = append(participantIDs, userID)
	}

	unpinBytes, err := json.Marshal(gin.H{
		"type": "message_unpinned",
		"payload": gin.H{
			"conversation_id": conversationID,
			"message_id":      messageID,
			"participant_ids": participantIDs,
		},
	})
	if err != nil {
		log.Println("Failed to marshal message unpin:", err)
		return
	}

	writeToUsers(ctx, unpinBytes, participantIDs...)
}

func writeToUsers(ctx context.Context, payload []byte, userIDs ...uint) {
	sentTo := make(map[uint]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 {
			continue
		}
		if _, exists := sentTo[userID]; exists {
			continue
		}
		sentTo[userID] = struct{}{}

		for _, toConn := range clients.getAll(userID) {
			if err := toConn.write(ctx, payload); err != nil {
				log.Println("Failed to send websocket event:", err)
			}
		}
	}
}

func emitExpiredCallTimeouts(ctx context.Context, database *gorm.DB) {
	if database == nil {
		return
	}
	expired, err := repository.ExpireStaleRingingCallsWithResult(database)
	if err != nil {
		log.Printf("failed to expire stale calls: error=%v", err)
		return
	}
	for _, call := range expired {
		sendCallStateEvent(ctx, "call:timeout", call.CallerID, call.CallID, call.CallerID, call.CalleeID)
		enqueueCallStateNotification(database, call.CalleeID, call.CallerID, notifications.TypeCallMissed, call.CallID, conversationIDForCall(call), call.CallType)
		closeLiveKitRoom(ctx, liveKitInstance, call.CallID)
		log.Printf("call state transition: call_id=%s from=ringing to=timeout reason=server_timeout caller_id=%d callee_id=%d", call.CallID, call.CallerID, call.CalleeID)
	}

	staleActive, err := repository.ExpireStaleAcceptedCallsWithResult(database)
	if err != nil {
		log.Printf("failed to expire stale active calls: error=%v", err)
		return
	}
	for _, call := range staleActive {
		sendCallStateEvent(ctx, "call:end", call.CallerID, call.CallID, call.CallerID, call.CalleeID)
		enqueueCallStateNotification(database, call.CalleeID, call.CallerID, notifications.TypeCallEnded, call.CallID, conversationIDForCall(call), call.CallType)
		closeLiveKitRoom(ctx, liveKitInstance, call.CallID)
		log.Printf("call state transition: call_id=%s from=accepted to=ended reason=heartbeat_timeout caller_id=%d callee_id=%d", call.CallID, call.CallerID, call.CalleeID)
	}
}

func handleCallHeartbeat(fromID uint, toID uint, payload json.RawMessage) {
	var callPayload struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(payload, &callPayload); err != nil {
		log.Println("Invalid call heartbeat payload:", err)
		return
	}

	callID := strings.TrimSpace(callPayload.CallID)
	if callID == "" {
		log.Println("Invalid call heartbeat payload: missing call_id")
		return
	}

	if _, ok, err := repository.MarkCallHeartbeat(dbInstance, fromID, toID, callID); err != nil {
		log.Printf("failed to record call heartbeat: call_id=%s from_id=%d to_id=%d error=%v", callID, fromID, toID, err)
	} else if !ok {
		log.Printf("call heartbeat ignored: call_id=%s from_id=%d to_id=%d", callID, fromID, toID)
	}
}
