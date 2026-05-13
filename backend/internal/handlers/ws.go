package handlers

import (
	"context"
	"encoding/json"
	"log"
	"tester/internal/auth"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var Clients = make(map[uint]*websocket.Conn)
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

	Clients[userID] = conn
	defer delete(Clients, userID)

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
			toID := uint(rawMsg["to_id"].(float64))
			isTyping := rawMsg["is_typing"].(bool)

			if toConn, ok := Clients[toID]; ok {
				typingMsg := map[string]interface{}{
					"type":      "typing",
					"from_id":   userID,
					"is_typing": isTyping,
				}
				typingBytes, _ := json.Marshal(typingMsg)
				toConn.Write(ctx, websocket.MessageText, typingBytes)
			}

		case "read_receipt":
			toID := uint(rawMsg["to_id"].(float64))

			// Обновляем is_read в БД
			dbInstance.Model(&models.Message{}).
				Where("from_id = ? AND to_id = ? AND is_read = false", toID, userID).
				Update("is_read", true)

			// Отправляем уведомление отправителю
			if toConn, ok := Clients[toID]; ok {
				receiptMsg := map[string]interface{}{
					"type":    "read_receipt",
					"from_id": userID,
					"to_id":   toID,
				}
				receiptBytes, _ := json.Marshal(receiptMsg)
				toConn.Write(ctx, websocket.MessageText, receiptBytes)
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

			if toConn, ok := Clients[msg.ToID]; ok {
				toConn.Write(ctx, websocket.MessageText, fullMessageBytes)
			}

			if fromConn, ok := Clients[userID]; ok {
				fromConn.Write(ctx, websocket.MessageText, fullMessageBytes)
			}
		}
	}
}
