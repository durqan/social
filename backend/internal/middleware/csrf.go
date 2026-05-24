package middleware

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	CSRFHeaderName = "X-CSRF-Token"
	CSRFCookieName = "csrf_token"
)

func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		if strings.HasPrefix(c.GetHeader("Authorization"), BearerPrefix) {
			c.Next()
			return
		}

		cookieToken, err := c.Cookie(CSRFCookieName)
		if err != nil || cookieToken == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "csrf token required"})
			c.Abort()
			return
		}

		headerToken := c.GetHeader(CSRFHeaderName)
		if headerToken == "" || subtle.ConstantTimeCompare([]byte(cookieToken), []byte(headerToken)) != 1 {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid csrf token"})
			c.Abort()
			return
		}

		c.Next()
	}
}
