package middleware

import (
	"log"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func UserActivityMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if value, ok := c.Get("user_id"); ok {
			if userID, ok := value.(uint); ok {
				if _, err := services.MarkUserActivity(db, userID); err != nil {
					log.Println("failed to update user activity:", err)
				}
			}
		}

		c.Next()
	}
}
