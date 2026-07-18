package handlers

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"tester/internal/auth"
	livekitservice "tester/internal/livekit"
	"tester/internal/middleware"
	"tester/internal/services"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var dbInstance *gorm.DB
var liveKitInstance *livekitservice.Service
var websocketContext = context.Background()

const (
	websocketPingInterval    = 30 * time.Second
	websocketMaxMessageSize  = 1024 * 1024
	callTimeoutSweepInterval = 5 * time.Second
)

func InitWebSocket(ctx context.Context, db *gorm.DB, liveKit *livekitservice.Service) {
	if ctx == nil {
		ctx = context.Background()
	}
	websocketContext = ctx
	dbInstance = db
	liveKitInstance = liveKit
	go startCallTimeoutSweeper(ctx, db)
}

func startCallTimeoutSweeper(ctx context.Context, db *gorm.DB) {
	ticker := time.NewTicker(callTimeoutSweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			emitExpiredCallTimeouts(ctx, db)
		}
	}
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

	conn, err := websocket.Accept(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	conn.SetReadLimit(websocketMaxMessageSize)

	client, becameOnline := clients.set(userID, conn)
	if _, err := services.MarkUserActivity(dbInstance, userID); err != nil {
		log.Println("failed to update websocket connect activity:", err)
	}

	if becameOnline {
		broadcastPresence(userID, true, nil)
	}

	ctx, cancel := context.WithCancel(websocketContext)
	defer cancel()
	defer removeWebSocketClient(userID, client, "read loop exit")
	go keepWebSocketAlive(ctx, client)

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if !isClosedWebSocketError(err) {
				log.Printf("websocket user %d disconnected: %v", userID, err)
			}
			break
		}

		var wsMsg WSMessage
		if err := json.Unmarshal(data, &wsMsg); err != nil {
			log.Println("Invalid websocket envelope:", err)
			continue
		}

		handleWebSocketMessage(ctx, userID, client, wsMsg)
	}
}

func ShutdownWebSockets() {
	clients.closeAll(websocket.StatusGoingAway, "server shutdown")
}

func keepWebSocketAlive(ctx context.Context, client *websocketClient) {
	ticker := time.NewTicker(websocketPingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := client.ping(ctx); err != nil {
				_ = client.conn.Close(websocket.StatusPolicyViolation, "ping timeout")
				return
			}
		}
	}
}

func removeWebSocketClient(userID uint, client *websocketClient, reason string) {
	removed, isOffline := clients.remove(userID, client)
	if !removed {
		return
	}

	_ = client.conn.CloseNow()

	if !isOffline {
		return
	}

	lastSeenAt, err := services.ForceUserActivity(dbInstance, userID)
	if err != nil {
		log.Println("failed to update last_seen_at:", err)
	}

	broadcastPresence(userID, false, lastSeenAt)
}
