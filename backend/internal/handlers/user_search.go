package handlers

import (
	"tester/internal/dto"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SearchUsersByNameOrEmail(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		if query == "" {
			c.JSON(400, gin.H{"error": "query parameter is required"})
			return
		}

		users, err := repository.GetUsersByEmailOrName(db, query)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to search users"})
			return
		}

		c.JSON(200, dto.ToUserResponses(users))
	}
}
