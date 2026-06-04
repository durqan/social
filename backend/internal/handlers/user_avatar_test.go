package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type mockAvatarStorage struct {
	uploads      map[string][]byte
	contentTypes map[string]string
	deleted      []string
}

func newMockAvatarStorage() *mockAvatarStorage {
	return &mockAvatarStorage{
		uploads:      make(map[string][]byte),
		contentTypes: make(map[string]string),
	}
}

func (s *mockAvatarStorage) Upload(_ context.Context, key string, r io.Reader, contentType string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.uploads[key] = data
	s.contentTypes[key] = contentType
	return nil
}

func (s *mockAvatarStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}

func (s *mockAvatarStorage) URL(_ context.Context, key string) (string, error) {
	return "https://storage.yandexcloud.net/private-bucket/" + key, nil
}

type mockSignedAvatarStorage struct {
	*mockAvatarStorage
	signedURL string
	signedKey string
	signedTTL time.Duration
}

func (s *mockSignedAvatarStorage) SignedURL(_ context.Context, key string, ttl time.Duration) (string, error) {
	s.signedKey = key
	s.signedTTL = ttl
	return s.signedURL, nil
}

func TestUploadAvatarUsesStorageAndStoresObjectKey(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := routerWithUser(1)
	r.PATCH("/users/:id/avatar", UploadAvatar(db))

	w := httptest.NewRecorder()
	req := avatarUploadRequest(t, "/users/1/avatar", "../../evil.png", tinyPNG)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var response struct {
		Avatar string `json:"avatar"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Avatar != "/api/avatars/users/1" {
		t.Fatalf("unexpected avatar response %q", response.Avatar)
	}
	if strings.Contains(response.Avatar, "storage.yandexcloud.net") {
		t.Fatalf("avatar response must not contain direct S3 URL: %q", response.Avatar)
	}

	var updated models.User
	if err := db.First(&updated, 1).Error; err != nil {
		t.Fatalf("load updated user: %v", err)
	}
	assertAvatarKey(t, updated.Avatar)
	if strings.Contains(updated.Avatar, "evil") {
		t.Fatalf("object key must not include original filename, got %q", updated.Avatar)
	}
	if _, ok := store.uploads[updated.Avatar]; !ok {
		t.Fatalf("expected upload for stored key %q", updated.Avatar)
	}
	if store.contentTypes[updated.Avatar] != "image/png" {
		t.Fatalf("unexpected content type %q", store.contentTypes[updated.Avatar])
	}
}

func TestUploadAvatarDeletesOldAvatarOnReplace(t *testing.T) {
	store := newMockAvatarStorage()
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	oldKey := "avatars/user_1/old-avatar.webp"
	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: oldKey}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := routerWithUser(1)
	r.PATCH("/users/:id/avatar", UploadAvatar(db))

	w := httptest.NewRecorder()
	req := avatarUploadRequest(t, "/users/1/avatar", "avatar.png", tinyPNG)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if len(store.deleted) != 1 || store.deleted[0] != oldKey {
		t.Fatalf("expected old avatar %q to be deleted, got %#v", oldKey, store.deleted)
	}

	var updated models.User
	if err := db.First(&updated, 1).Error; err != nil {
		t.Fatalf("load updated user: %v", err)
	}
	assertAvatarKey(t, updated.Avatar)
	if updated.Avatar == oldKey {
		t.Fatal("expected avatar key to be replaced")
	}
}

func TestGetUserAvatarRedirectsToSignedURLForS3(t *testing.T) {
	store := &mockSignedAvatarStorage{
		mockAvatarStorage: newMockAvatarStorage(),
		signedURL:         "https://storage.yandexcloud.net/private-bucket/avatars/user_1/avatar.png?X-Amz-Signature=test",
	}
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	key := "avatars/user_1/avatar.png"
	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: key}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := avatarDeliveryRouter(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/avatars/users/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected 307, got %d: %s", w.Code, w.Body.String())
	}
	if location := w.Header().Get("Location"); location != store.signedURL {
		t.Fatalf("unexpected redirect location %q", location)
	}
	if store.signedKey != key {
		t.Fatalf("expected signed key %q, got %q", key, store.signedKey)
	}
	if store.signedTTL != avatarSignedURLTTL {
		t.Fatalf("expected signed ttl %s, got %s", avatarSignedURLTTL, store.signedTTL)
	}
}

func TestGetUserAvatarServesLocalStorage(t *testing.T) {
	runInTempWorkdir(t)
	store := storage.NewLocalStorage("uploads", "")
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	key := "avatars/user_1/avatar.png"
	writeAvatarObject(t, key)

	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: key}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := avatarDeliveryRouter(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/avatars/users/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), tinyPNG) {
		t.Fatalf("unexpected avatar body %q", w.Body.Bytes())
	}
}

func TestGetUserAvatarServesLegacyLocalPath(t *testing.T) {
	runInTempWorkdir(t)
	store := storage.NewLocalStorage("uploads", "")
	defer storage.SetDefaultForTest(store)()

	db := testDB(t)
	key := "avatars/1_avatar.png"
	writeAvatarObject(t, key)

	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash", Avatar: "/uploads/" + key}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := avatarDeliveryRouter(db)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/avatars/users/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), tinyPNG) {
		t.Fatalf("unexpected avatar body %q", w.Body.Bytes())
	}
}

func avatarUploadRequest(t *testing.T, target string, filename string, data []byte) *http.Request {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("avatar", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPatch, target, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func assertAvatarKey(t *testing.T, key string) {
	t.Helper()

	pattern := regexp.MustCompile(`^avatars/user_1/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$`)
	if !pattern.MatchString(key) {
		t.Fatalf("unexpected avatar key %q", key)
	}
}

func avatarDeliveryRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/avatars/users/:id", GetUserAvatar(db))
	return r
}

func writeAvatarObject(t *testing.T, key string) {
	t.Helper()

	path := filepath.Join("uploads", filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir avatar dir: %v", err)
	}
	if err := os.WriteFile(path, tinyPNG, 0644); err != nil {
		t.Fatalf("write avatar: %v", err)
	}
}
