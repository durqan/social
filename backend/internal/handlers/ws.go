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

func (c *websocketClient) write(ctx context.Context, data []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.conn.Write(ctx, websocket.MessageText, data)
}

func newWebsocketRegistry() *websocketRegistry {
	return &websocketRegistry{clients: make(map[uint]*websocketClient)}
}

func (r *websocketRegistry) set(userID uint, conn *websocket.Conn) *websocketClient {
	client := &websocketClient{conn: conn}
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
		var rawMsg map[string]interface{}
		_, data, err := conn.Read(ctx)
		if err != nil {
			log.Printf("User %d disconnected", userID)
			break
		}

		if err := json.Unmarshal(data, &rawMsg); err != nil {
			log.Println("Invalid message:", err)
			continue
		}

		msgType, _ := rawMsg["type"].(string)

		switch msgType {
		case "typing":
			var msg struct {
				ToID     uint `json:"to_id"`
				IsTyping bool `json:"is_typing"`
			}
			if err := json.Unmarshal(data, &msg); err != nil || msg.ToID == 0 {
				log.Println("Invalid typing event:", err)
				continue
			}

			if toConn, ok := clients.get(msg.ToID); ok {
				typingMsg := map[string]interface{}{
					"type":      "typing",
					"from_id":   userID,
					"is_typing": msg.IsTyping,
				}
				typingBytes, _ := json.Marshal(typingMsg)
				if err := toConn.write(ctx, typingBytes); err != nil {
					log.Println("Failed to send typing event:", err)
				}
			}

		case "read_receipt":
			var msg struct {
				ToID uint `json:"to_id"`
			}
			if err := json.Unmarshal(data, &msg); err != nil || msg.ToID == 0 {
				log.Println("Invalid read receipt:", err)
				continue
			}

			dbInstance.Model(&models.Message{}).
				Where("from_id = ? AND to_id = ? AND is_read = false", msg.ToID, userID).
				Update("is_read", true)

			if toConn, ok := clients.get(msg.ToID); ok {
				receiptMsg := map[string]interface{}{
					"type":    "read_receipt",
					"from_id": userID,
					"to_id":   msg.ToID,
				}
				receiptBytes, _ := json.Marshal(receiptMsg)
				if err := toConn.write(ctx, receiptBytes); err != nil {
					log.Println("Failed to send read receipt:", err)
				}
			}

		default:
			var msg struct {
				ToID    uint   `json:"to_id"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal(data, &msg); err != nil {
				log.Println("Invalid message:", err)
				continue
			}
			if msg.ToID == 0 || msg.Content == "" {
				log.Println("Invalid message payload")
				continue
			}

			message := models.Message{
				FromID:  userID,
				ToID:    msg.ToID,
				Content: msg.Content,
				IsRead:  false,
			}

			if err := repository.CreateMessage(dbInstance, &message); err != nil {
				log.Println("Failed to save message:", err)
				continue
			}

			var fullMessage models.Message
			dbInstance.Preload("From").Preload("To").First(&fullMessage, message.ID)

			fullMessageBytes, err := json.Marshal(fullMessage)
			if err != nil {
				log.Println("Failed to marshal message:", err)
				continue
			}

			if toConn, ok := clients.get(msg.ToID); ok {
				if err := toConn.write(ctx, fullMessageBytes); err != nil {
					log.Println("Failed to send message to recipient:", err)
				}
			}

			if fromConn, ok := clients.get(userID); ok {
				if err := fromConn.write(ctx, fullMessageBytes); err != nil {
					log.Println("Failed to send message to sender:", err)
				}
			}
		}
	}
}
