package handlers

import (
	"context"
	"encoding/json"
	"log"
	"strings"

	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
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
	var payload struct {
		ToID        uint                     `json:"to_id"`
		Content     string                   `json:"content"`
		Attachments []messageAttachmentInput `json:"attachments"`
	}

	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Println("Invalid message payload:", err)
		return
	}

	content := strings.TrimSpace(payload.Content)
	attachments, err := normalizeMessageAttachments(payload.Attachments, userID)
	if err != nil {
		log.Println("Invalid attachments:", err)
		return
	}

	if payload.ToID == 0 || (content == "" && len(attachments) == 0) {
		log.Println("Invalid message data")
		return
	}

	message := models.Message{
		FromID:  userID,
		ToID:    payload.ToID,
		Content: content,
		IsRead:  false,
	}

	if err := repository.CreateMessage(dbInstance, &message); err != nil {
		log.Println("Failed to save message:", err)
		return
	}

	for i := range attachments {
		attachments[i].MessageID = message.ID
	}

	if err := repository.CreateMessageAttachments(dbInstance, attachments); err != nil {
		log.Println("Failed to save attachments:", err)
		return
	}

	publishNotification(payload.ToID, userID, dto.NotificationTypeMessage, message.ID)

	var fullMessage models.Message
	dbInstance.
		Preload("From").
		Preload("To").
		Preload("Attachments").
		First(&fullMessage, message.ID)

	messageBytes, err := json.Marshal(gin.H{
		"type":    "message:new",
		"payload": withPrivateAttachmentURLs(fullMessage),
	})
	if err != nil {
		log.Println("Failed to marshal message:", err)
		return
	}

	for _, toConn := range clients.getAll(payload.ToID) {
		if err := toConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message to recipient:", err)
		}
	}

	for _, fromConn := range clients.getAll(userID) {
		if err := fromConn.write(ctx, messageBytes); err != nil {
			log.Println("Failed to send message to sender:", err)
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

	if toConn, ok := clients.get(payload.ToID); ok {
		typingBytes, _ := json.Marshal(gin.H{
			"type": eventType,
			"payload": gin.H{
				"from_id": userID,
			},
		})

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

	result := dbInstance.Model(&models.Message{}).
		Where(
			"from_id = ? AND to_id = ? AND is_read = false",
			payload.ToID,
			userID,
		).
		Update("is_read", true)
	if result.Error != nil {
		log.Println("Failed to mark messages as read:", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		invalidateMessageCaches()
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

	if toConn, ok := clients.get(toID); ok {
		if err := toConn.write(ctx, eventBytes); err != nil {
			log.Println("Failed to forward call event:", err)
		}
	}
}
