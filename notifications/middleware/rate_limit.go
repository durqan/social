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

func RateLimit(limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		key := fmt.Sprintf("%s:%s", c.ClientIP(), path)

		if !allowRateLimit(key, limit, window) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			c.Abort()
			return
		}

		c.Next()
	}
}

func allowRateLimit(key string, limit int, window time.Duration) bool {
	if limit <= 0 || window <= 0 {
		return true
	}

	now := time.Now()

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
