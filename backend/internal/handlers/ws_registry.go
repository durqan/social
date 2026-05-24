package handlers

import (
	"context"
	"sync"

	"github.com/coder/websocket"
)

type websocketRegistry struct {
	mu      sync.RWMutex
	clients map[uint]map[*websocketClient]struct{}
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
	return &websocketRegistry{
		clients: make(map[uint]map[*websocketClient]struct{}),
	}
}

func (r *websocketRegistry) set(userID uint, conn *websocket.Conn) *websocketClient {
	client := &websocketClient{
		conn: conn,
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

func (r *websocketRegistry) remove(userID uint, client *websocketClient) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if userClients, ok := r.clients[userID]; ok {
		delete(userClients, client)
		if len(userClients) > 0 {
			return false
		}
		delete(r.clients, userID)
	}

	return true
}

var clients = newWebsocketRegistry()
