package middleware

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func InternalToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		expectedToken := os.Getenv("INTERNAL_SERVICE_TOKEN")
		if expectedToken == "" {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal token is not configured"})
			c.Abort()
			return
		}

		token := c.GetHeader("X-Internal-Token")
		if token == "" || token != expectedToken {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			c.Abort()
			return
		}

		c.Next()
	}
}
