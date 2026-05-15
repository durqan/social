package middleware

import (
	"fmt"
	"net/http"
	"tester/internal/cache"
	"time"

	"github.com/gin-gonic/gin"
)

func RateLimitMiddleware(limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.Next()
			return
		}

		key := fmt.Sprintf("ratelimit:%d:%s", userID, c.Request.URL.Path)

		count, err := cache.Redis.Client.Incr(cache.Redis.Ctx, key).Result()
		if err != nil {
			c.Next()
			return
		}

		if count == 1 {
			cache.Redis.Client.Expire(cache.Redis.Ctx, key, window)
		}

		if count > int64(limit) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
