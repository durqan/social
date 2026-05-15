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
var dbInstance *gorm.DB

func InitWebSocket(db *gorm.DB) {
	dbInstance = db
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
		InsecureSkipVerify: true,
	})

	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	defer conn.Close(websocket.StatusNormalClosure, "")

	client := clients.set(userID, conn)
	defer clients.remove(userID, client)

	log.Printf("User %d connected", userID)

	ctx := context.Background()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			log.Printf("User %d disconnected", userID)
			break
		}

		var wsMsg WSMessage

		if err := json.Unmarshal(data, &wsMsg); err != nil {
			log.Println("Invalid websocket envelope:", err)
			continue
		}

		switch wsMsg.Type {
		case "message":

			var payload struct {
				ToID    uint   `json:"to_id"`
				Content string `json:"content"`
			}

			if err := json.Unmarshal(wsMsg.Payload, &payload); err != nil {
				log.Println("Invalid message payload:", err)
				continue
			}

			if payload.ToID == 0 || payload.Content == "" {
				log.Println("Invalid message data")
				continue
			}

			message := models.Message{
				FromID:  userID,
				ToID:    payload.ToID,
				Content: payload.Content,
				IsRead:  false,
			}

			if err := repository.CreateMessage(dbInstance, &message); err != nil {
				log.Println("Failed to save message:", err)
				continue
			}

			var fullMessage models.Message

			dbInstance.
				Preload("From").
				Preload("To").
				First(&fullMessage, message.ID)

			messageBytes, err := json.Marshal(gin.H{
				"type":    "message",
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
		case "typing":

			var payload struct {
				ToID     uint `json:"to_id"`
				IsTyping bool `json:"is_typing"`
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
					"type": "typing",
					"payload": gin.H{
						"from_id":   userID,
						"is_typing": payload.IsTyping,
					},
				})

				if err := toConn.write(ctx, typingBytes); err != nil {
					log.Println("Failed to send typing event:", err)
				}
			}
		case "read_receipt":

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
					"type": "read_receipt",
					"payload": gin.H{
						"from_id": userID,
						"to_id":   payload.ToID,
					},
				})

				if err := toConn.write(ctx, receiptBytes); err != nil {
					log.Println("Failed to send read receipt:", err)
				}
			}
		default:
			log.Println("Unknown websocket event:", wsMsg.Type)
		}
	}
}
