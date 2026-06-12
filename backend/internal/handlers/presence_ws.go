package handlers

import (
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

	recipients := clients.all()

	for _, client := range recipients {
		_ = client.write(nil, payload)
	}
}
