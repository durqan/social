package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"tester/internal/dto"
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

var callEventOrder = struct {
	sync.Mutex
	seenIDs map[string]time.Time
}{
	seenIDs: make(map[string]time.Time),
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
	case "call:offer", "call:answer", "call:ice", "call:end", "call:reject":
		if _, ok := authorizeRealtimePeerEvent(userID, wsMsg.Payload, wsMsg.Type); !ok {
			return
		}
		forwardCallEvent(ctx, wsMsg.Type, userID, wsMsg.Payload)
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
}

func StartMessageUpdateSubscriber(database *gorm.DB) {
	services.StartMessageUpdateListener(database, BroadcastMessageUpdate)
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
	visibleMessage, err := repository.GetMessageByIDForUser(db, message.ID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
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
			"reaction_version": visibleMessage.ReactionVersion,
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

func forwardCallEvent(ctx context.Context, eventType string, fromID uint, payload json.RawMessage) {
	emitExpiredCallTimeouts(ctx, dbInstance)

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
	callID = strings.TrimSpace(callID)
	if callID == "" {
		log.Println("Invalid call payload: empty call_id")
		return
	}

	callType := callTypeFromPayload(callPayload)
	if !acceptCallEventOrder(fromID, callID, callPayload) {
		log.Printf("late or duplicate call event ignored: type=%s call_id=%s from_id=%d", eventType, callID, fromID)
		return
	}
	transition, ok := recordCallEvent(eventType, fromID, toID, callID, callType, callOfferPayload(callPayload), callAnswerPayload(callPayload), callCandidatePayload(callPayload))

	if !ok {
		log.Printf("call event ignored before forward: type=%s call_id=%s from_id=%d to_id=%d", eventType, callID, fromID, toID)
		return
	}
	for _, replaced := range transition.Replaced {
		sendCallStateEvent(ctx, "call:replaced", fromID, replaced.CallID, replaced.CallerID, replaced.CalleeID)
		enqueueCallStateNotification(dbInstance, replaced.CalleeID, replaced.CallerID, dto.NotificationTypeCallEnded, replaced.CallID, conversationIDForCall(replaced), replaced.CallType)
		log.Printf("call state transition: call_id=%s from=ringing to=replaced reason=new_offer caller_id=%d callee_id=%d", replaced.CallID, replaced.CallerID, replaced.CalleeID)
	}
	notificationCallType := transition.CallType
	if notificationCallType == "" {
		notificationCallType = callType
	}
	if eventType == "call:offer" {
		log.Printf(
			"call:offer received, attempting incoming_call push publish: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d",
			callID, fromID, toID, fromID,
		)
		go enqueueIncomingCallNotification(dbInstance, toID, fromID, callID, fromID, notificationCallType)
	}
	if eventType == "call:end" {
		go enqueueCallStateNotification(dbInstance, toID, fromID, dto.NotificationTypeCallEnded, callID, fromID, notificationCallType)
	}
	if eventType == "call:reject" {
		go enqueueCallStateNotification(dbInstance, toID, fromID, dto.NotificationTypeCallRejected, callID, fromID, notificationCallType)
	}

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

	toConnections := clients.getAll(toID)
	deliveredCount := 0
	failedCount := 0
	for _, toConn := range toConnections {
		if err := toConn.write(ctx, eventBytes); err != nil {
			failedCount++
			log.Printf("call event persisted but websocket forward failed: type=%s call_id=%s from_id=%d to_id=%d error=%v", eventType, callID, fromID, toID, err)
			continue
		}
		deliveredCount++
	}
	status := transition.Status
	if status == "" {
		status = "forwarded_without_state"
	}

	log.Printf("call event persisted: type=%s call_id=%s from_id=%d to_id=%d status=%s websocket_clients=%d delivered=%d failed=%d", eventType, callID, fromID, toID, status, len(toConnections), deliveredCount, failedCount)
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
		enqueueCallStateNotification(database, call.CalleeID, call.CallerID, dto.NotificationTypeCallMissed, call.CallID, conversationIDForCall(call), call.CallType)
		log.Printf("call state transition: call_id=%s from=ringing to=missed reason=server_timeout caller_id=%d callee_id=%d", call.CallID, call.CallerID, call.CalleeID)
	}

	staleActive, err := repository.ExpireStaleAnsweredCallsWithResult(database)
	if err != nil {
		log.Printf("failed to expire stale active calls: error=%v", err)
		return
	}
	for _, call := range staleActive {
		sendCallStateEvent(ctx, "call:end", call.CallerID, call.CallID, call.CallerID, call.CalleeID)
		enqueueCallStateNotification(database, call.CalleeID, call.CallerID, dto.NotificationTypeCallEnded, call.CallID, conversationIDForCall(call), call.CallType)
		log.Printf("call state transition: call_id=%s from=answered to=ended reason=heartbeat_timeout caller_id=%d callee_id=%d", call.CallID, call.CallerID, call.CalleeID)
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

func acceptCallEventOrder(fromID uint, callID string, payload map[string]json.RawMessage) bool {
	if fromID == 0 || callID == "" {
		return false
	}

	var eventID string
	if raw, ok := payload["event_id"]; ok {
		_ = json.Unmarshal(raw, &eventID)
		eventID = strings.TrimSpace(eventID)
	}
	callEventOrder.Lock()
	defer callEventOrder.Unlock()

	now := time.Now()
	if eventID != "" {
		key := callID + ":" + eventID
		if _, exists := callEventOrder.seenIDs[key]; exists {
			return false
		}
		callEventOrder.seenIDs[key] = now
	}
	if len(callEventOrder.seenIDs) > 10000 {
		cutoff := now.Add(-10 * time.Minute)
		for key, seenAt := range callEventOrder.seenIDs {
			if seenAt.Before(cutoff) {
				delete(callEventOrder.seenIDs, key)
			}
		}
	}
	return true
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

func callOfferPayload(callPayload map[string]json.RawMessage) string {
	raw, ok := callPayload["offer"]
	if !ok || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

func callAnswerPayload(callPayload map[string]json.RawMessage) string {
	raw, ok := callPayload["answer"]
	if !ok || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

func callCandidatePayload(callPayload map[string]json.RawMessage) string {
	raw, ok := callPayload["candidate"]
	if !ok || len(raw) == 0 {
		return ""
	}
	return string(raw)
}

type callTransitionResult struct {
	models.CallLog
	Replaced []models.CallLog
}

func recordCallEvent(eventType string, fromID uint, toID uint, callID string, callType string, offerPayload string, answerPayload string, candidatePayload string) (callTransitionResult, bool) {
	var transition callTransitionResult
	if dbInstance == nil {
		return transition, false
	}

	var err error
	var shouldForward bool
	switch eventType {
	case "call:offer":
		conversationID := fromID
		var created *models.CallLog
		created, transition.Replaced, shouldForward, err = repository.CreateCallOffer(dbInstance, fromID, toID, callID, callType, &conversationID, offerPayload)
		if errors.Is(err, repository.ErrCallBusy) {
			sendCallStateEvent(context.Background(), "call:busy", toID, callID, fromID)
			log.Printf("call event rejected: type=call:offer call_id=%s caller_id=%d callee_id=%d reason=busy", callID, fromID, toID)
			return transition, false
		}
		if created != nil {
			transition.CallLog = *created
		}
	case "call:answer":
		transition.CallLog, shouldForward, err = repository.MarkCallAnswered(dbInstance, fromID, toID, callID, answerPayload)
	case "call:reject":
		transition.CallLog, shouldForward, err = repository.MarkCallDeclined(dbInstance, fromID, toID, callID)
	case "call:end":
		transition.CallLog, shouldForward, err = repository.MarkCallEnded(dbInstance, fromID, toID, callID)
	case "call:ice":
		transition.CallLog, shouldForward, err = repository.AppendCallIceCandidate(dbInstance, fromID, toID, callID, candidatePayload)
	default:
		return transition, false
	}

	if err != nil {
		log.Printf("failed to record %s call event: call_id=%s from_id=%d to_id=%d error=%v", eventType, callID, fromID, toID, err)
		return transition, false
	}
	if shouldForward {
		log.Printf("call state transition accepted: type=%s call_id=%s from_id=%d to_id=%d status=%s", eventType, callID, fromID, toID, transition.Status)
	}
	return transition, shouldForward
}
