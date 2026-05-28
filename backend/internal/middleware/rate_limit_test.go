package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestRateLimitMiddlewareLimitsByIP(t *testing.T) {
	resetRateLimitStoreForTest()
	gin.SetMode(gin.TestMode)

	router := gin.New()
	router.GET("/limited", RateLimitMiddleware(2, time.Hour), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/limited", nil)
		req.RemoteAddr = "203.0.113.1:1234"
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNoContent {
			t.Fatalf("request %d: expected 204, got %d", i+1, w.Code)
		}
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/limited", nil)
	req.RemoteAddr = "203.0.113.1:1234"
	router.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after limit, got %d", w.Code)
	}
}

func resetRateLimitStoreForTest() {
	rateLimitStore.Lock()
	defer rateLimitStore.Unlock()

	rateLimitStore.entries = make(map[string]rateLimitEntry)
}
