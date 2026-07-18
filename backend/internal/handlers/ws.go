package handlers

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"tester/internal/auth"
	"tester/internal/dto"
	"tester/internal/middleware"
	"tester/internal/repository"
	"tester/internal/services"

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
var websocketContext = context.Background()

const (
	websocketPingInterval    = 30 * time.Second
	websocketMaxMessageSize  = 1024 * 1024
	callTimeoutSweepInterval = 5 * time.Second
)

func InitWebSocket(ctx context.Context, db *gorm.DB) {
	if ctx == nil {
		ctx = context.Background()
	}
	websocketContext = ctx
	dbInstance = db
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

	client := clients.set(userID, conn)
	if _, err := services.MarkUserActivity(dbInstance, userID); err != nil {
		log.Println("failed to update websocket connect activity:", err)
	}

	onlineUsers.mu.Lock()
	wasOnline := onlineUsers.users[userID]
	onlineUsers.users[userID] = true
	onlineUsers.mu.Unlock()

	if !wasOnline {
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
	onlineUsers.mu.Lock()
	onlineUsers.users = make(map[uint]bool)
	onlineUsers.mu.Unlock()
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

	onlineUsers.mu.Lock()
	delete(onlineUsers.users, userID)
	onlineUsers.mu.Unlock()

	lastSeenAt, err := services.ForceUserActivity(dbInstance, userID)
	if err != nil {
		log.Println("failed to update last_seen_at:", err)
	}

	endActiveCallsForOfflineUser(userID)
	broadcastPresence(userID, false, lastSeenAt)
}

func endActiveCallsForOfflineUser(userID uint) {
	if dbInstance == nil || userID == 0 {
		return
	}

	endedCalls, err := repository.EndActiveCallsForOfflineUser(dbInstance, userID)
	if err != nil {
		log.Printf("failed to end active calls for offline user: user_id=%d error=%v", userID, err)
		return
	}

	for _, call := range endedCalls {
		peerID := call.CalleeID
		if userID == call.CalleeID {
			peerID = call.CallerID
		}

		sendCallStateEvent(context.Background(), "call:end", userID, call.CallID, call.CallerID, call.CalleeID)
		enqueueCallStateNotification(dbInstance, peerID, userID, dto.NotificationTypeCallEnded, call.CallID, conversationIDForCall(call), call.CallType)
		log.Printf("call state transition: call_id=%s from=active to=ended reason=participant_offline user_id=%d caller_id=%d callee_id=%d", call.CallID, userID, call.CallerID, call.CalleeID)
	}
}
