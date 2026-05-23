package handlers

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	"tester/internal/auth"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"strings"
)

type websocketRegistry struct {
	mu      sync.RWMutex
	clients map[uint]*websocketClient
}

type websocketClient struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
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

func (c *websocketClient) write(ctx context.Context, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	return c.conn.Write(ctx, websocket.MessageText, data)
}

func newWebsocketRegistry() *websocketRegistry {
	return &websocketRegistry{
		clients: make(map[uint]*websocketClient),
	}
}

func (r *websocketRegistry) set(userID uint, conn *websocket.Conn) *websocketClient {
	client := &websocketClient{
		conn: conn,
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.clients[userID] = client

	return client
}

func (r *websocketRegistry) get(userID uint) (*websocketClient, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	client, ok := r.clients[userID]

	return client, ok
}

func (r *websocketRegistry) remove(userID uint, client *websocketClient) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if current, ok := r.clients[userID]; ok && current == client {
		delete(r.clients, userID)
	}
}

var clients = newWebsocketRegistry()

var onlineUsers = struct {
	mu    sync.RWMutex
	users map[uint]bool
}{
	users: make(map[uint]bool),
}

var dbInstance *gorm.DB
var websocketOriginPatterns []string

func InitWebSocket(db *gorm.DB, originPatterns []string) {
	dbInstance = db
	websocketOriginPatterns = originPatterns
}

func WebSocketHandler(c *gin.Context) {
	token, err := c.Cookie("token")
	if err != nil {
		c.JSON(401, gin.H{"error": "no token"})
		return
	}

	userID, err := auth.ValidateToken(token)
	if err != nil {
		c.JSON(401, gin.H{"error": "invalid token"})
		return
	}

	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
		OriginPatterns: websocketOriginPatterns,
	})

	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	defer conn.Close(websocket.StatusNormalClosure, "")

	client := clients.set(userID, conn)

	onlineUsers.mu.Lock()
	onlineUsers.users[userID] = true
	onlineUsers.mu.Unlock()

	broadcastPresence(userID, true)

	defer clients.remove(userID, client)

	defer func() {

		onlineUsers.mu.Lock()
		delete(onlineUsers.users, userID)
		onlineUsers.mu.Unlock()

		broadcastPresence(userID, false)

	}()

	ctx := context.Background()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			log.Printf("User %s disconnected", err)
			break
		}

		var wsMsg WSMessage

		if err := json.Unmarshal(data, &wsMsg); err != nil {
			log.Println("Invalid websocket envelope:", err)
			continue
		}

		switch wsMsg.Type {
		case "message:send":

			var payload struct {
				ToID        uint                     `json:"to_id"`
				Content     string                   `json:"content"`
				Attachments []messageAttachmentInput `json:"attachments"`
			}

			if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
				log.Println("Invalid message payload:", err)
				continue
			}

			content := strings.TrimSpace(payload.Content)
			attachments, err := normalizeMessageAttachments(payload.Attachments)
			if err != nil {
				log.Println("Invalid attachments:", err)
				continue
			}

			if payload.ToID == 0 || (content == "" && len(attachments) == 0) {
				log.Println("Invalid message data")
				continue
			}

			message := models.Message{
				FromID:  userID,
				ToID:    payload.ToID,
				Content: content,
				IsRead:  false,
			}

			if err := repository.CreateMessage(dbInstance, &message); err != nil {
				log.Println("Failed to save message:", err)
				continue
			}

			for i := range attachments {
				attachments[i].MessageID = message.ID
			}

			if err := repository.CreateMessageAttachments(dbInstance, attachments); err != nil {
				log.Println("Failed to save attachments:", err)
				continue
			}

			var fullMessage models.Message

			dbInstance.
				Preload("From").
				Preload("To").
				Preload("Attachments").
				First(&fullMessage, message.ID)

			messageBytes, err := json.Marshal(gin.H{
				"type":    "message:new",
				"payload": fullMessage,
			})

			if err != nil {
				log.Println("Failed to marshal message:", err)
				continue
			}

			if toConn, ok := clients.get(payload.ToID); ok {
				if err := toConn.write(ctx, messageBytes); err != nil {
					log.Println("Failed to send message to recipient:", err)
				}
			}

			if fromConn, ok := clients.get(userID); ok {
				if err := fromConn.write(ctx, messageBytes); err != nil {
					log.Println("Failed to send message to sender:", err)
				}
			}
		case "typing:start", "typing:stop":

			var payload struct {
				ToID uint `json:"to_id"`
			}

			if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
				log.Println("Invalid typing payload:", err)
				continue
			}

			if payload.ToID == 0 {
				continue
			}

			if toConn, ok := clients.get(payload.ToID); ok {

				typingBytes, _ := json.Marshal(gin.H{
					"type": wsMsg.Type,
					"payload": gin.H{
						"from_id": userID,
					},
				})

				if err := toConn.write(ctx, typingBytes); err != nil {
					log.Println("Failed to send typing event:", err)
				}
			}
		case "message:read":

			var payload struct {
				ToID uint `json:"to_id"`
			}

			if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
				log.Println("Invalid read receipt payload:", err)
				continue
			}

			if payload.ToID == 0 {
				continue
			}

			dbInstance.Model(&models.Message{}).
				Where(
					"from_id = ? AND to_id = ? AND is_read = false",
					payload.ToID,
					userID,
				).
				Update("is_read", true)

			if toConn, ok := clients.get(payload.ToID); ok {

				receiptBytes, _ := json.Marshal(gin.H{
					"type": "message:read",
					"payload": gin.H{
						"from_id": userID,
						"to_id":   payload.ToID,
					},
				})

				if err := toConn.write(ctx, receiptBytes); err != nil {
					log.Println("Failed to send read receipt:", err)
				}
			}
		case "call:offer", "call:answer", "call:ice", "call:end", "call:reject":
			forwardCallEvent(ctx, wsMsg.Type, userID, wsMsg.Payload)
		default:
			log.Println("Unknown websocket event:", wsMsg.Type)
		}
	}
}
