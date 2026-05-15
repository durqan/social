package middleware

import (
	"fmt"
	"net/http"
	"tester/internal/cache"
	"time"

	"github.com/gin-gonic/gin"
)

func CacheMiddleware(ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Next()
			return
		}

		key := "cache:" + c.Request.URL.Path + ":" + c.Request.URL.RawQuery

		// user-specific cache
		if userID, exists := c.Get("user_id"); exists {
			key += fmt.Sprintf(":user:%v", userID)
		}

		// Получаем raw JSON из Redis
		cached, err := cache.Redis.Client.Get(cache.Redis.Ctx, key).Bytes()

		if err == nil {
			c.Data(http.StatusOK, "application/json", cached)
			c.Abort()
			return
		}

		blw := &bodyLogWriter{
			body:           []byte{},
			ResponseWriter: c.Writer,
		}

		c.Writer = blw

		c.Next()

		if c.Writer.Status() == http.StatusOK {
			_ = cache.Redis.Client.Set(
				cache.Redis.Ctx,
				key,
				blw.body,
				ttl,
			).Err()
		}
	}
}

type bodyLogWriter struct {
	gin.ResponseWriter
	body []byte
}

func (w *bodyLogWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}
