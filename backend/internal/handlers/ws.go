package handlers

import (
	"context"
	"encoding/json"
	"log"
	"sync"

	"tester/internal/auth"
	"tester/internal/middleware"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

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
	token, err := c.Cookie(middleware.AuthCookieName)
	if err != nil {
		c.JSON(401, gin.H{"error": "no token"})
		return
	}

	userID, _, err := auth.ValidateToken(token)
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
	wasOnline := onlineUsers.users[userID]
	onlineUsers.users[userID] = true
	onlineUsers.mu.Unlock()

	if !wasOnline {
		broadcastPresence(userID, true)
	}

	defer func() {
		isOffline := clients.remove(userID, client)
		if !isOffline {
			return
		}

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

		handleWebSocketMessage(ctx, userID, wsMsg)
	}
}
