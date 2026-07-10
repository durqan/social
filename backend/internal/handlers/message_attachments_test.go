package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"tester/internal/models"
	"tester/internal/storage"

	"github.com/gin-gonic/gin"
)

func TestMessageAttachmentDownloadFilename(t *testing.T) {
	tests := []struct {
		name        string
		attachment  models.MessageAttachment
		key         string
		contentType string
		want        string
	}{
		{
			name: "uses original filename",
			attachment: models.MessageAttachment{
				ID:               11,
				FileType:         "file",
				OriginalFilename: "report final.pdf",
			},
			key:         "messages/user_1/uuid.bin",
			contentType: "application/pdf",
			want:        "report final.pdf",
		},
		{
			name: "generates image filename",
			attachment: models.MessageAttachment{
				ID:       42,
				FileType: "image",
			},
			key:         "messages/user_1/uuid",
			contentType: "image/png",
			want:        "image-42.png",
		},
		{
			name: "generates audio filename for voice",
			attachment: models.MessageAttachment{
				ID:       7,
				FileType: "voice",
			},
			key:         "voice/user_1/uuid.webm",
			contentType: "audio/webm",
			want:        "audio-7.webm",
		},
		{
			name: "uses key extension for generic file",
			attachment: models.MessageAttachment{
				ID:       9,
				FileType: "file",
			},
			key:         "messages/user_1/archive.zip",
			contentType: "",
			want:        "file-9.zip",
		},
		{
			name: "generates video note filename",
			attachment: models.MessageAttachment{
				ID:       13,
				FileType: "video_note",
			},
			key:         "video-notes/user_1/uuid.webm",
			contentType: "video/webm",
			want:        "video-note-13.webm",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := messageAttachmentDownloadFilename(&tt.attachment, tt.key, tt.contentType)
			if got != tt.want {
				t.Fatalf("messageAttachmentDownloadFilename() = %q, want %q", got, tt.want)
			}
		})
	}
}

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
