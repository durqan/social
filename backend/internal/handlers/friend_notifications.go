package handlers

import (
	"context"
	"encoding/json"

	"tester/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func notifyFriendEvent(
	db *gorm.DB,
	recipientID uint,
	senderID uint,
	eventType string,
	message string,
) {
	var sender models.User
	db.First(&sender, senderID)

	notificationBytes, _ := json.Marshal(gin.H{
		"type": eventType,
		"payload": gin.H{
			"from_id":   senderID,
			"from_name": sender.Name,
			"message":   message,
		},
	})

	for _, toConn := range clients.getAll(recipientID) {
		_ = toConn.write(context.Background(), notificationBytes)
	}
}
