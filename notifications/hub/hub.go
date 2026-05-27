package hub

import (
	"notifications/models"
	"sync"
)

type Client chan models.Notification

type Hub struct {
	mu      sync.RWMutex
	clients map[uint]map[Client]struct{}
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[uint]map[Client]struct{}),
	}
}

func (h *Hub) AddClient(userID uint) (Client, func()) {
	client := make(Client, 10)

	h.mu.Lock()
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[Client]struct{})
	}
	h.clients[userID][client] = struct{}{}
	h.mu.Unlock()

	cleanup := func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		if userClients, ok := h.clients[userID]; ok {
			delete(userClients, client)
			if len(userClients) == 0 {
				delete(h.clients, userID)
			}
		}

		close(client)
	}

	return client, cleanup
}

func (h *Hub) SendToUser(userID uint, notification models.Notification) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients[userID] {
		select {
		case client <- notification:
		default:
		}
	}
}
