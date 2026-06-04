package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"regexp"
	"strings"
	"testing"

	"tester/internal/services"
	"tester/internal/storage"
)

var tinyWebMVoice = []byte{
	0x1a, 0x45, 0xdf, 0xa3,
	0x42, 0x86, 0x81, 0x01,
}

func TestUploadMessageVoiceUsesStorageAndStoresObjectKey(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-voice", UploadMessageVoice(nil))

	w := httptest.NewRecorder()
	req := voiceUploadRequest(t, "/messages/upload-voice", "../../evil.webm", "audio/webm", tinyWebMVoice, "2.2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var response services.MessageAttachmentInput
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.AttachmentID == "" {
		t.Fatal("expected pending attachment id")
	}
	if response.FileType != "voice" {
		t.Fatalf("expected voice attachment, got %q", response.FileType)
	}
	if response.Duration != 3 || response.DurationSeconds != 3 {
		t.Fatalf("expected rounded duration 3 seconds, got duration=%d duration_seconds=%d", response.Duration, response.DurationSeconds)
	}
	if !strings.HasPrefix(response.FileURL, "/api/messages/uploads/") {
		t.Fatalf("unexpected file url %q", response.FileURL)
	}

	if len(store.uploads) != 1 {
		t.Fatalf("expected one upload, got %d", len(store.uploads))
	}
	var key string
	for uploadedKey := range store.uploads {
		key = uploadedKey
	}
	pattern := regexp.MustCompile(`^voice/user_1/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webm$`)
	if !pattern.MatchString(key) {
		t.Fatalf("unexpected object key %q", key)
	}
	if strings.Contains(key, "evil") {
		t.Fatalf("object key must not include original filename, got %q", key)
	}
	if !bytes.Equal(store.uploads[key], tinyWebMVoice) {
		t.Fatalf("unexpected uploaded bytes %q", store.uploads[key])
	}
	if store.contentTypes[key] != "audio/webm" {
		t.Fatalf("unexpected content type %q", store.contentTypes[key])
	}
}

func TestUploadMessageVoiceRejectsInvalidContentType(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-voice", UploadMessageVoice(nil))

	w := httptest.NewRecorder()
	req := voiceUploadRequest(t, "/messages/upload-voice", "voice.webm", "text/plain", tinyWebMVoice, "2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func TestUploadMessageVoiceRejectsInvalidMagicBytes(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-voice", UploadMessageVoice(nil))

	w := httptest.NewRecorder()
	req := voiceUploadRequest(t, "/messages/upload-voice", "voice.webm", "audio/webm", []byte("not-audio"), "2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func voiceUploadRequest(t *testing.T, target string, filename string, contentType string, data []byte, duration string) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="voice"; filename="`+filename+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write voice: %v", err)
	}
	if err := writer.WriteField("duration", duration); err != nil {
		t.Fatalf("write duration: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestUploadMessageVideoNoteUsesStorageAndStoresObjectKey(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "video/webm", tinyWebMVoice, "3.7")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var response services.MessageAttachmentInput
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.AttachmentID == "" {
		t.Fatal("expected pending attachment id")
	}
	if response.FileType != "video_note" {
		t.Fatalf("expected video_note attachment, got %q", response.FileType)
	}
	if response.Duration != 4 || response.DurationSeconds != 4 {
		t.Fatalf("expected rounded duration 4 seconds, got duration=%d duration_seconds=%d", response.Duration, response.DurationSeconds)
	}
	if !strings.HasPrefix(response.FileURL, "/api/messages/uploads/") {
		t.Fatalf("unexpected file url %q", response.FileURL)
	}

	if len(store.uploads) != 1 {
		t.Fatalf("expected one upload, got %d", len(store.uploads))
	}
	var key string
	for uploadedKey := range store.uploads {
		key = uploadedKey
	}
	pattern := regexp.MustCompile(`^video-notes/user_1/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webm$`)
	if !pattern.MatchString(key) {
		t.Fatalf("unexpected object key %q", key)
	}
	if strings.Contains(key, "evil") {
		t.Fatalf("object key must not include original filename, got %q", key)
	}
	if !bytes.Equal(store.uploads[key], tinyWebMVoice) {
		t.Fatalf("unexpected uploaded bytes")
	}
	if store.contentTypes[key] != "video/webm" {
		t.Fatalf("unexpected content type %q", store.contentTypes[key])
	}
}

func TestUploadMessageVideoNoteRejectsInvalidContentType(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "text/plain", tinyWebMVoice, "2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func TestUploadMessageVideoNoteRejectsInvalidMagicBytes(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "video/webm", []byte("not-video"), "2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func videoNoteUploadRequest(t *testing.T, target string, filename string, contentType string, data []byte, duration string) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="video_note"; filename="`+filename+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write video note: %v", err)
	}
	if err := writer.WriteField("duration", duration); err != nil {
		t.Fatalf("write duration: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}
