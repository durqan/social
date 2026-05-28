package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type rateLimitEntry struct {
	Count   int
	ResetAt time.Time
}

var rateLimitStore = struct {
	sync.Mutex
	entries map[string]rateLimitEntry
}{
	entries: make(map[string]rateLimitEntry),
}

func RateLimitMiddleware(limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		identity := fmt.Sprintf("ip:%s", c.ClientIP())
		if userID, exists := c.Get("user_id"); exists {
			identity = fmt.Sprintf("user:%v", userID)
		}

		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}

		if !AllowRateLimit(identity, path, limit, window) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

func AllowRateLimit(identity string, scope string, limit int, window time.Duration) bool {
	if limit <= 0 || window <= 0 {
		return true
	}

	now := time.Now()
	key := fmt.Sprintf("%s:%s", identity, scope)

	rateLimitStore.Lock()
	defer rateLimitStore.Unlock()

	entry, exists := rateLimitStore.entries[key]
	if !exists || !now.Before(entry.ResetAt) {
		rateLimitStore.entries[key] = rateLimitEntry{
			Count:   1,
			ResetAt: now.Add(window),
		}
		cleanupExpiredRateLimits(now)
		return true
	}

	if entry.Count >= limit {
		return false
	}

	entry.Count++
	rateLimitStore.entries[key] = entry
	return true
}

func cleanupExpiredRateLimits(now time.Time) {
	if len(rateLimitStore.entries) < 1000 {
		return
	}

	for key, entry := range rateLimitStore.entries {
		if !now.Before(entry.ResetAt) {
			delete(rateLimitStore.entries, key)
		}
	}
}
