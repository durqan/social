package handlers

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
)

func broadcastPresence(
	userID uint,
	online bool,
	lastSeenAt *time.Time,
) {

	payload, _ := json.Marshal(gin.H{
		"type": "presence:update",
		"payload": gin.H{
			"user_id":      userID,
			"online":       online,
			"last_seen_at": lastSeenAt,
		},
	})

	recipients := clients.all()

	for _, client := range recipients {
		_ = client.write(nil, payload)
	}
}
