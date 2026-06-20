package handlers

import (
	"strconv"
	"tester/internal/models"

	"github.com/gin-gonic/gin"
)

func IsUserOnline(userID uint) bool {

	onlineUsers.mu.RLock()
	defer onlineUsers.mu.RUnlock()

	return onlineUsers.users[userID]
}

func GetPresence(c *gin.Context) {

	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(400, gin.H{
			"error": "invalid user id",
		})
		return
	}

	online := IsUserOnline(uint(id))
	var lastSeenAt interface{}
	if dbInstance != nil {
		var user models.User
		if err := dbInstance.Select("last_seen_at").First(&user, uint(id)).Error; err == nil {
			lastSeenAt = user.LastSeenAt
		}
	}

	c.JSON(200, gin.H{
		"online":       online,
		"last_seen_at": lastSeenAt,
	})
}
