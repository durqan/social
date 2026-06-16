package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"tester/internal/middleware"
	"tester/internal/models"
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
	case "call:offer", "call:answer", "call:ice", "call:end", "call:reject":
		if _, ok := authorizeRealtimePeerEvent(userID, wsMsg.Payload, wsMsg.Type); !ok {
			return
		}
		forwardCallEvent(ctx, wsMsg.Type, userID, wsMsg.Payload)
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
		ToID                   uint                              `json:"to_id"`
		Content                string                            `json:"content"`
		Attachments            []services.MessageAttachmentInput `json:"attachments"`
		ReplyToMessageID       *uint                             `json:"replyToMessageId"`
		ReplyToMessageIDLegacy *uint                             `json:"reply_to_message_id"`
		EncryptionVersion      int                               `json:"encryption_version"`
		EncryptionVersionCamel int                               `json:"encryptionVersion"`
		Ciphertext             string                            `json:"ciphertext"`
		Nonce                  string                            `json:"nonce"`
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

	replyToMessageID := payload.ReplyToMessageID
	if replyToMessageID == nil {
		replyToMessageID = payload.ReplyToMessageIDLegacy
	}

	fullMessage, err := services.SendMessage(dbInstance, userID, payload.ToID, payload.Content, attachments, replyToMessageID, requestEncryption(payload.EncryptionVersion, payload.EncryptionVersionCamel, payload.Ciphertext, payload.Nonce))
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

	if err := services.MarkConversationRead(dbInstance, payload.ToID, userID); err != nil {
		log.Println("Failed to mark messages as read:", err)
		return
	}

	sendMessageReadReceipt(ctx, userID, payload.ToID)
	sendConversationReadSync(ctx, userID, payload.ToID)
	enqueueMessageReadSync(dbInstance, userID, payload.ToID)
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

func forwardCallEvent(ctx context.Context, eventType string, fromID uint, payload json.RawMessage) {
	var callPayload map[string]json.RawMessage

	if err := json.Unmarshal(payload, &callPayload); err != nil {
		log.Println("Invalid call payload:", err)
		return
	}

	toRaw, ok := callPayload["to_id"]
	if !ok {
		return
	}

	var toID uint
	if err := json.Unmarshal(toRaw, &toID); err != nil || toID == 0 {
		return
	}

	delete(callPayload, "to_id")

	callIDRaw, ok := callPayload["call_id"]
	if !ok {
		log.Println("Invalid call payload: missing call_id")
		return
	}

	var callID string
	if err := json.Unmarshal(callIDRaw, &callID); err != nil || callID == "" {
		log.Println("Invalid call payload: invalid call_id")
		return
	}

	callType := callTypeFromPayload(callPayload)
	recordCallEvent(eventType, fromID, toID, callID, callType)

	// === INCOMING CALL WEB PUSH (only for offer) ===
	// All other signalling events (call:answer, call:ice, call:end, call:reject) MUST NOT
	// create Notification records or trigger pushes. This is enforced by the if below.
	if eventType == "call:offer" {
		// Structured context for observability (call_id, ids, etc.).
		log.Printf(
			"call:offer received, attempting incoming_call push publish: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d",
			callID, fromID, toID, fromID,
		)

		// From the callee's (toID) perspective the conversation partner (for chat deep link) is the caller (fromID).
		// Publish is intentionally decoupled (goroutine) so that any Rabbit / notifications-service
		// unavailability or slowness CANNOT break or delay the WebSocket call signalling path.
		// Errors inside publish are logged (as warning/error) but execution continues to WS forward.
		go enqueueIncomingCallNotification(dbInstance, toID, fromID, callID, fromID)
	}

	// Why we send push even if the user has active WS connections:
	// - The current architecture has no server-side "call session" concept and no
	//   reliable signal "this user is actively watching for calls on this device".
	// - A WebSocket connection only means "at least one tab/socket for the user is open".
	//   The tab may be on another route, the PWA may be backgrounded, or the user
	//   may simply not be looking at the screen.
	// - The primary goal of this feature is to surface incoming calls when the web/PWA
	//   client cannot deliver the offer via WS (closed tab, killed PWA, background, etc.).
	// - Duplicate ringing is acceptable: the in-app CallOverlay (driven by WS) is the
	//   preferred UX when possible. The push serves as wake-up + deep-link + missed-call record.
	// - A future improvement could consult presence or the WS registry length before publishing,
	//   but even that would be a heuristic, not a guarantee.
	// We deliberately do NOT guard the publish on len(clients.getAll(toID)) == 0.

	eventPayload := gin.H{
		"from_id": fromID,
	}

	for key, value := range callPayload {
		eventPayload[key] = value
	}

	eventBytes, err := json.Marshal(gin.H{
		"type":    eventType,
		"payload": eventPayload,
	})
	if err != nil {
		log.Println("Failed to marshal call event:", err)
		return
	}

	for _, toConn := range clients.getAll(toID) {
		if err := toConn.write(ctx, eventBytes); err != nil {
			log.Println("Failed to forward call event:", err)
		}
	}
}

func callTypeFromPayload(callPayload map[string]json.RawMessage) string {
	raw, ok := callPayload["call_type"]
	if !ok {
		return models.CallTypeAudio
	}

	var callType string
	if err := json.Unmarshal(raw, &callType); err != nil {
		return models.CallTypeAudio
	}
	return repository.NormalizeCallType(callType)
}

func recordCallEvent(eventType string, fromID uint, toID uint, callID string, callType string) {
	if dbInstance == nil {
		return
	}

	// TODO: mark stale ringing calls as missed with a bounded background sweep.
	// A disconnect alone is not reliable enough here because users may reconnect,
	// have multiple devices, or keep a tab alive while the callee never answers.
	var err error
	switch eventType {
	case "call:offer":
		_, err = repository.CreateCallOffer(dbInstance, fromID, toID, callID, callType, nil)
	case "call:answer":
		err = repository.MarkCallAnswered(dbInstance, fromID, toID, callID)
	case "call:reject":
		err = repository.MarkCallDeclined(dbInstance, fromID, toID, callID)
	case "call:end":
		err = repository.MarkCallEnded(dbInstance, fromID, toID, callID)
	case "call:ice":
		return
	}

	if err != nil {
		log.Printf("failed to record %s call event: call_id=%s from_id=%d to_id=%d error=%v", eventType, callID, fromID, toID, err)
	}
}
