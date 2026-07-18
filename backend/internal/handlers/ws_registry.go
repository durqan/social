package handlers

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const websocketWriteTimeout = 5 * time.Second

type websocketRegistry struct {
	mu      sync.RWMutex
	clients map[uint]map[*websocketClient]struct{}
}

type websocketClient struct {
	userID               uint
	conn                 *websocket.Conn
	writeMu              sync.Mutex
	stateMu              sync.RWMutex
	activeConversationID uint
}

func (c *websocketClient) write(ctx context.Context, data []byte) error {
	if ctx == nil {
		ctx = context.Background()
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	writeCtx, cancel := context.WithTimeout(ctx, websocketWriteTimeout)
	defer cancel()

	if err := c.conn.Write(writeCtx, websocket.MessageText, data); err != nil {
		if !isClosedWebSocketError(err) {
			log.Printf("websocket write failed for user %d: %v", c.userID, err)
		}
		removeWebSocketClient(c.userID, c, "write failure")
		return err
	}

	return nil
}

func (c *websocketClient) ping(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()

	pingCtx, cancel := context.WithTimeout(ctx, websocketWriteTimeout)
	defer cancel()

	if err := c.conn.Ping(pingCtx); err != nil {
		if !isClosedWebSocketError(err) {
			log.Printf("websocket ping failed for user %d: %v", c.userID, err)
		}
		removeWebSocketClient(c.userID, c, "ping failure")
		return err
	}

	return nil
}

func newWebsocketRegistry() *websocketRegistry {
	return &websocketRegistry{
		clients: make(map[uint]map[*websocketClient]struct{}),
	}
}

func (r *websocketRegistry) set(userID uint, conn *websocket.Conn) (*websocketClient, bool) {
	client := &websocketClient{
		userID: userID,
		conn:   conn,
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	becameOnline := len(r.clients[userID]) == 0
	if becameOnline {
		r.clients[userID] = make(map[*websocketClient]struct{})
	}
	r.clients[userID][client] = struct{}{}

	return client, becameOnline
}

func (r *websocketRegistry) getAll(userID uint) []*websocketClient {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userClients := r.clients[userID]
	result := make([]*websocketClient, 0, len(userClients))
	for client := range userClients {
		result = append(result, client)
	}

	return result
}

func (r *websocketRegistry) all() []*websocketClient {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*websocketClient
	for _, userClients := range r.clients {
		for client := range userClients {
			result = append(result, client)
		}
	}

	return result
}

func (r *websocketRegistry) remove(userID uint, client *websocketClient) (bool, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if userClients, ok := r.clients[userID]; ok {
		if _, ok := userClients[client]; !ok {
			return false, false
		}
		delete(userClients, client)
		if len(userClients) > 0 {
			return true, false
		}
		delete(r.clients, userID)

		return true, true
	}

	return false, false
}

func (r *websocketRegistry) closeAll(status websocket.StatusCode, reason string) {
	r.mu.Lock()
	all := make([]*websocketClient, 0)
	for _, userClients := range r.clients {
		for client := range userClients {
			all = append(all, client)
		}
	}
	r.clients = make(map[uint]map[*websocketClient]struct{})
	r.mu.Unlock()

	for _, client := range all {
		_ = client.conn.Close(status, reason)
	}
}

func (r *websocketRegistry) setActiveConversation(userID uint, client *websocketClient, conversationID uint) bool {
	r.mu.RLock()
	_, ok := r.clients[userID][client]
	r.mu.RUnlock()
	if !ok {
		return false
	}

	client.stateMu.Lock()
	client.activeConversationID = conversationID
	client.stateMu.Unlock()
	return true
}

func (r *websocketRegistry) hasActiveConversation(userID uint, conversationID uint) bool {
	if userID == 0 || conversationID == 0 {
		return false
	}
	for _, client := range r.getAll(userID) {
		client.stateMu.RLock()
		active := client.activeConversationID == conversationID
		client.stateMu.RUnlock()
		if active {
			return true
		}
	}
	return false
}

// IsConversationActive reports whether any live connection is currently
// displaying the conversation. The notification worker uses this existing
// WebSocket state to suppress redundant message pushes.
func IsConversationActive(userID uint, conversationID uint) bool {
	return clients.hasActiveConversation(userID, conversationID)
}

func isClosedWebSocketError(err error) bool {
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		websocket.CloseStatus(err) != -1
}

var clients = newWebsocketRegistry()
