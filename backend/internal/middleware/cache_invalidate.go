package middleware

import (
	"log"
	"net/http"
	"tester/internal/cache"

	"github.com/gin-gonic/gin"
)

func InvalidateCache(patterns ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		switch c.Request.Method {
		case http.MethodPost,
			http.MethodPut,
			http.MethodPatch,
			http.MethodDelete:
		default:
			return
		}

		if c.Writer.Status() >= 200 && c.Writer.Status() < 300 {
			for _, pattern := range patterns {
				if err := cache.Redis.DeletePattern(pattern); err != nil {
					log.Println("cache invalidate error:", err)
				}
			}
		}
	}
}
