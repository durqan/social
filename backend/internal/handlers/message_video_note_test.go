package handlers

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"tester/internal/models"
	"tester/internal/services"
	"tester/internal/storage"
)

var tinyWebMVideoNote = []byte{
	0x1a, 0x45, 0xdf, 0xa3,
	0x42, 0x86, 0x81, 0x01,
}

func TestUploadMessageVideoNoteUsesStorageAndStoresObjectKey(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "../../evil.webm", "video/webm", tinyWebMVideoNote, "2.2")
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
	pattern := regexp.MustCompile(`^video-notes/user_1/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webm$`)
	if !pattern.MatchString(key) {
		t.Fatalf("unexpected object key %q", key)
	}
	if strings.Contains(key, "evil") {
		t.Fatalf("object key must not include original filename, got %q", key)
	}
	if !bytes.Equal(store.uploads[key], tinyWebMVideoNote) {
		t.Fatalf("unexpected uploaded bytes %q", store.uploads[key])
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
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "text/plain", tinyWebMVideoNote, "2")
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

func TestUploadMessageVideoNoteRejectsTooLongDuration(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "video/webm", tinyWebMVideoNote, "61")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func TestUploadMessageVideoNoteRejectsTooLargeFile(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	data := append([]byte{}, tinyWebMVideoNote...)
	data = append(data, bytes.Repeat([]byte{0}, int(services.ChatVideoNoteMaxSize)-len(data)+1)...)

	r := routerWithUser(1)
	r.POST("/messages/upload-video-note", UploadMessageVideoNote(nil))

	w := httptest.NewRecorder()
	req := videoNoteUploadRequest(t, "/messages/upload-video-note", "note.webm", "video/webm", data, "2")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.uploads) != 0 {
		t.Fatalf("expected no uploads, got %d", len(store.uploads))
	}
}

func TestSendMessageAllowsVideoNoteWithText(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	friendship := models.Friendship{UserID: 1, FriendID: 2, Status: "accepted"}
	if err := db.Create(&friendship).Error; err != nil {
		t.Fatalf("create friendship: %v", err)
	}

	filename := "00000000-0000-4000-8000-000000000001.webm"
	body := `{"content":"комментарий","attachments":[{"file_url":"` +
		services.PrivateUploadURL(filename) +
		`","file_type":"video_note","duration_seconds":2,"size":128}]}`

	r := routerWithUser(1)
	r.POST("/messages/send/:toId", SendMessage(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/messages/send/2", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var attachment models.MessageAttachment
	if err := db.First(&attachment).Error; err != nil {
		t.Fatalf("load attachment: %v", err)
	}
	if attachment.FileType != "video_note" {
		t.Fatalf("expected video_note attachment, got %q", attachment.FileType)
	}
	if attachment.FileURL != services.VideoNoteUploadKey(filename, 1) {
		t.Fatalf("expected video note object key, got %q", attachment.FileURL)
	}
}

func TestGetMessageAttachmentServesVideoNoteInline(t *testing.T) {
	runInTempWorkdir(t)
	store := storage.NewLocalStorage("uploads", "")
	defer storage.SetDefaultForTest(store)()

	key := "video-notes/user_1/note.webm"
	writeVideoNoteObject(t, key, tinyWebMVideoNote)

	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}
	message := models.Message{FromID: 1, ToID: 2, Content: "note"}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}
	attachment := models.MessageAttachment{
		MessageID:       message.ID,
		FileURL:         key,
		FileType:        "video_note",
		DurationSeconds: intPtr(2),
		Size:            int64(len(tinyWebMVideoNote)),
	}
	if err := db.Create(&attachment).Error; err != nil {
		t.Fatalf("create attachment: %v", err)
	}

	r := routerWithUser(2)
	r.GET("/messages/attachments/:id", GetMessageAttachment(db))
	r.HEAD("/messages/attachments/:id", GetMessageAttachment(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/messages/attachments/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for HEAD, got %d: %s", w.Code, w.Body.String())
	}
	if contentType := w.Header().Get("Content-Type"); contentType != "video/webm" {
		t.Fatalf("expected video/webm content type, got %q", contentType)
	}
	if disposition := w.Header().Get("Content-Disposition"); disposition != "inline" {
		t.Fatalf("expected inline disposition, got %q", disposition)
	}
	if acceptRanges := w.Header().Get("Accept-Ranges"); acceptRanges != "bytes" {
		t.Fatalf("expected bytes ranges, got %q", acceptRanges)
	}

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/messages/attachments/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for GET, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes()[:4], tinyWebMVideoNote[:4]) {
		t.Fatalf("unexpected first bytes %x", w.Body.Bytes()[:4])
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

func writeVideoNoteObject(t *testing.T, key string, data []byte) {
	t.Helper()

	path := filepath.Join("uploads", filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir video note dir: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write video note: %v", err)
	}
}

func intPtr(value int) *int {
	return &value
}
