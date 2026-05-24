package middleware

import (
	"strings"
	"tester/internal/auth"

	"github.com/gin-gonic/gin"
)

const (
	AuthCookieName = "token"
	BearerPrefix   = "Bearer "
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(AuthCookieName)
		if err != nil {
			token = c.GetHeader("Authorization")
			if strings.HasPrefix(token, BearerPrefix) {
				token = strings.TrimPrefix(token, BearerPrefix)
			} else {
				c.JSON(401, gin.H{"error": "authorization required"})
				c.Abort()
				return
			}
		}

		userID, sessionID, err := auth.ValidateToken(token)
		if err != nil {
			c.JSON(401, gin.H{"error": "invalid or expired token"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)
		c.Set("session_id", sessionID)
		c.Next()
	}
}
