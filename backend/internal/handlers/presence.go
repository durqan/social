package handlers

import (
	"strconv"

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

	c.JSON(200, gin.H{
		"online": online,
	})
}
