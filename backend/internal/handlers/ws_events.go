package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
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

func handleWebSocketMessage(ctx context.Context, userID uint, wsMsg WSMessage) {
	switch wsMsg.Type {
	case "message:send":
		handleWebSocketSendMessage(ctx, userID, wsMsg.Payload)
	case "typing:start", "typing:stop":
		handleWebSocketTyping(ctx, userID, wsMsg.Type, wsMsg.Payload)
	case "message:read":
		handleWebSocketReadReceipt(ctx, userID, wsMsg.Payload)
	case "call:offer", "call:answer", "call:ice", "call:end", "call:reject":
		forwardCallEvent(ctx, wsMsg.Type, userID, wsMsg.Payload)
	default:
		log.Println("Unknown websocket event:", wsMsg.Type)
	}
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

	fullMessage, err := services.SendMessage(dbInstance, userID, payload.ToID, payload.Content, attachments, replyToMessageID)
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
	if err != nil {
		log.Println("Failed to save message:", err)
		return
	}

	publishNotification(payload.ToID, userID, dto.NotificationTypeMessage, fullMessage.ID)

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
	var payload struct {
		ToID uint `json:"to_id"`
	}

	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Println("Invalid typing payload:", err)
		return
	}

	if payload.ToID == 0 {
		return
	}

	typingBytes, _ := json.Marshal(gin.H{
		"type": eventType,
		"payload": gin.H{
			"from_id": userID,
		},
	})

	for _, toConn := range clients.getAll(payload.ToID) {
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
}

func sendMessageReadReceipt(ctx context.Context, readerID uint, senderID uint) {
	if senderID == 0 {
		return
	}

	receiptBytes, _ := json.Marshal(gin.H{
		"type": "message:read",
		"payload": gin.H{
			"from_id": readerID,
			"to_id":   senderID,
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
