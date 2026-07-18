package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"tester/internal/storage"

	"github.com/gin-gonic/gin"
)

func TestServeStoredObjectSupportsByteRanges(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := storage.NewLocalStorage(t.TempDir(), "")
	const key = "messages/user_1/video.mp4"
	if err := store.Upload(context.Background(), key, bytes.NewBufferString("0123456789"), "video/mp4"); err != nil {
		t.Fatalf("upload fixture: %v", err)
	}

	router := gin.New()
	router.GET("/video", func(c *gin.Context) {
		serveStoredObjectWithHeaders(c, store, key, "video/mp4", "inline")
	})
	router.HEAD("/video", func(c *gin.Context) {
		serveStoredObjectWithHeaders(c, store, key, "video/mp4", "inline")
	})

	rangeRequest := httptest.NewRequest(http.MethodGet, "/video", nil)
	rangeRequest.Header.Set("Range", "bytes=2-5")
	rangeResponse := httptest.NewRecorder()
	router.ServeHTTP(rangeResponse, rangeRequest)

	if rangeResponse.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d, want %d", rangeResponse.Code, http.StatusPartialContent)
	}
	if got := rangeResponse.Body.String(); got != "2345" {
		t.Fatalf("range body = %q, want %q", got, "2345")
	}
	if got := rangeResponse.Header().Get("Content-Type"); got != "video/mp4" {
		t.Fatalf("Content-Type = %q, want video/mp4", got)
	}
	if got := rangeResponse.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q, want bytes", got)
	}
	if got := rangeResponse.Header().Get("Content-Range"); got != "bytes 2-5/10" {
		t.Fatalf("Content-Range = %q, want bytes 2-5/10", got)
	}
	if got := rangeResponse.Header().Get("Content-Length"); got != "4" {
		t.Fatalf("Content-Length = %q, want 4", got)
	}
	if location := rangeResponse.Header().Get("Location"); location != "" {
		t.Fatalf("unexpected redirect Location = %q", location)
	}

	headRequest := httptest.NewRequest(http.MethodHead, "/video", nil)
	headResponse := httptest.NewRecorder()
	router.ServeHTTP(headResponse, headRequest)
	if headResponse.Code != http.StatusOK {
		t.Fatalf("HEAD status = %d, want %d", headResponse.Code, http.StatusOK)
	}
	if got := headResponse.Header().Get("Content-Length"); got != "10" {
		t.Fatalf("HEAD Content-Length = %q, want 10", got)
	}
	if headResponse.Body.Len() != 0 {
		t.Fatalf("HEAD body length = %d, want 0", headResponse.Body.Len())
	}
}
