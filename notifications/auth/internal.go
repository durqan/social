package auth

import (
	"crypto/subtle"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

const internalTokenHeader = "X-Internal-Token"

func InternalMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		expected := os.Getenv("NOTIFICATIONS_INTERNAL_TOKEN")
		provided := c.GetHeader(internalTokenHeader)
		if expected == "" || provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
			c.Abort()
			return
		}

		c.Next()
	}
}
