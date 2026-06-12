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
	userID  uint
	conn    *websocket.Conn
	writeMu sync.Mutex
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

func (r *websocketRegistry) set(userID uint, conn *websocket.Conn) *websocketClient {
	client := &websocketClient{
		userID: userID,
		conn:   conn,
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if r.clients[userID] == nil {
		r.clients[userID] = make(map[*websocketClient]struct{})
	}
	r.clients[userID][client] = struct{}{}

	return client
}

func (r *websocketRegistry) get(userID uint) (*websocketClient, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for client := range r.clients[userID] {
		return client, true
	}

	return nil, false
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

func isClosedWebSocketError(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

var clients = newWebsocketRegistry()
