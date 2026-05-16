package handlers

import (
	"context"
	"encoding/json"

	"github.com/gin-gonic/gin"
)

func broadcastPresence(
	userID uint,
	online bool,
) {

	payload, _ := json.Marshal(gin.H{
		"type": "presence:update",
		"payload": gin.H{
			"user_id": userID,
			"online":  online,
		},
	})

	clients.mu.RLock()
	defer clients.mu.RUnlock()

	for _, client := range clients.clients {
		client.write(
			context.Background(),
			payload,
		)
	}
}
