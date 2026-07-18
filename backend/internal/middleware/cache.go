package middleware

import (
	"fmt"
	"net/http"
	"tester/internal/cache"
	"time"

	"github.com/gin-gonic/gin"
)

const cachedNextCursorSuffix = ":header:x-next-cursor"

func CacheMiddleware(ttl time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			c.Next()
			return
		}

		key := "cache:" + c.Request.URL.Path + ":" + c.Request.URL.RawQuery
		cacheNextCursor := conversationListPath(c.Request.URL.Path)

		// user-specific cache
		if userID, exists := c.Get("user_id"); exists {
			key += fmt.Sprintf(":user:%v", userID)
		}

		// Получаем raw JSON из Redis
		cached, err := cache.Redis.Client.Get(cache.Redis.Ctx, key).Bytes()

		if err == nil {
			if cacheNextCursor {
				if cursor, cursorErr := cache.Redis.Client.Get(cache.Redis.Ctx, key+cachedNextCursorSuffix).Result(); cursorErr == nil && cursor != "" {
					c.Header("X-Next-Cursor", cursor)
				}
			}
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
			if !cacheNextCursor {
				_ = cache.Redis.Client.Set(cache.Redis.Ctx, key, blw.body, ttl).Err()
				return
			}
			pipeline := cache.Redis.Client.TxPipeline()
			pipeline.Set(
				cache.Redis.Ctx,
				key,
				blw.body,
				ttl,
			)
			if cursor := c.Writer.Header().Get("X-Next-Cursor"); cursor != "" {
				pipeline.Set(cache.Redis.Ctx, key+cachedNextCursorSuffix, cursor, ttl)
			} else {
				pipeline.Del(cache.Redis.Ctx, key+cachedNextCursorSuffix)
			}
			_, _ = pipeline.Exec(cache.Redis.Ctx)
		}
	}
}

func conversationListPath(path string) bool {
	return path == "/conversations" || path == "/messages/conversations"
}

type bodyLogWriter struct {
	gin.ResponseWriter
	body []byte
}

func (w *bodyLogWriter) Write(b []byte) (int, error) {
	w.body = append(w.body, b...)
	return w.ResponseWriter.Write(b)
}
