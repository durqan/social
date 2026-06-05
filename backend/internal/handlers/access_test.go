package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"tester/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
	0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
	0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
	0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59,
	0xe7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82,
}

func testDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.ConversationPin{},
		&models.PinnedMessage{},
		&models.Friendship{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	return db
}

func routerWithUser(userID uint) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	return r
}

func runInTempWorkdir(t *testing.T) {
	t.Helper()

	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("get cwd: %v", err)
	}

	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("chdir temp: %v", err)
	}

	t.Cleanup(func() {
		_ = os.Chdir(previous)
	})
}

func writeChatImage(t *testing.T, filename string) {
	t.Helper()

	dir := filepath.Join("uploads", "chat")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("mkdir uploads: %v", err)
	}

	if err := os.WriteFile(filepath.Join(dir, filename), tinyPNG, 0644); err != nil {
		t.Fatalf("write image: %v", err)
	}
}

func TestGetUploadedMessageImageRequiresOwner(t *testing.T) {
	runInTempWorkdir(t)
	writeChatImage(t, "1_image.png")

	r := routerWithUser(2)
	r.GET("/messages/uploads/:filename", GetUploadedMessageImage())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/messages/uploads/1_image.png", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-owner upload preview, got %d", w.Code)
	}

	r = routerWithUser(1)
	r.GET("/messages/uploads/:filename", GetUploadedMessageImage())

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/messages/uploads/1_image.png", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for owner upload preview, got %d", w.Code)
	}
}

func TestGetMessageAttachmentRequiresConversationParticipant(t *testing.T) {
	runInTempWorkdir(t)
	writeChatImage(t, "1_image.png")

	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
		{ID: 3, Name: "Eve", Email: "eve@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	message := models.Message{FromID: 1, ToID: 2, Content: "secret"}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	attachment := models.MessageAttachment{
		MessageID: message.ID,
		FileURL:   "/uploads/chat/1_image.png",
		FileType:  "image",
		Size:      int64(len(tinyPNG)),
	}
	if err := db.Create(&attachment).Error; err != nil {
		t.Fatalf("create attachment: %v", err)
	}

	r := routerWithUser(3)
	r.GET("/messages/attachments/:id", GetMessageAttachment(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/messages/attachments/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for non-participant attachment, got %d", w.Code)
	}

	r = routerWithUser(2)
	r.GET("/messages/attachments/:id", GetMessageAttachment(db))

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/messages/attachments/1", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for participant attachment, got %d", w.Code)
	}
}

func TestAcceptFriendRequestRejectsUnownedRequest(t *testing.T) {
	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
		{ID: 3, Name: "Eve", Email: "eve@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	friendship := models.Friendship{UserID: 1, FriendID: 2, Status: "pending"}
	if err := db.Create(&friendship).Error; err != nil {
		t.Fatalf("create friendship: %v", err)
	}

	r := routerWithUser(3)
	r.PATCH("/friends/:id/accept", AcceptFriendRequest(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/friends/1/accept", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unowned friend request, got %d", w.Code)
	}

	var updated models.Friendship
	if err := db.First(&updated, friendship.ID).Error; err != nil {
		t.Fatalf("load friendship: %v", err)
	}
	if updated.Status != "pending" {
		t.Fatalf("expected friendship to remain pending, got %q", updated.Status)
	}
}

func TestDeleteMessagesBatchRejectsNonParticipant(t *testing.T) {
	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
		{ID: 3, Name: "Eve", Email: "eve@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	message := models.Message{FromID: 1, ToID: 2, Content: "secret"}
	if err := db.Create(&message).Error; err != nil {
		t.Fatalf("create message: %v", err)
	}

	r := routerWithUser(3)
	r.DELETE("/messages/batch", DeleteMessagesBatch(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/messages/batch", strings.NewReader(`{"message_ids":[1]}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-participant delete, got %d", w.Code)
	}
}

func TestSendMessageRejectsNonFriend(t *testing.T) {
	db := testDB(t)
	users := []models.User{
		{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"},
		{ID: 2, Name: "Bob", Email: "bob@example.com", Password: "hash"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	r := routerWithUser(1)
	r.POST("/messages/send/:toId", SendMessage(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/messages/send/2", strings.NewReader(`{"content":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-friend message, got %d", w.Code)
	}

	var count int64
	if err := db.Model(&models.Message{}).Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no messages to be created, got %d", count)
	}
}

func TestSendMessageAllowsAcceptedFriend(t *testing.T) {
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

	r := routerWithUser(1)
	r.POST("/messages/send/:toId", SendMessage(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/messages/send/2", strings.NewReader(`{"content":"hello"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for accepted friend message, got %d", w.Code)
	}

	var count int64
	if err := db.Model(&models.Message{}).Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one message to be created, got %d", count)
	}
}

func TestSendMessageRejectsTooLongContent(t *testing.T) {
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

	r := routerWithUser(1)
	r.POST("/messages/send/:toId", SendMessage(db))

	w := httptest.NewRecorder()
	body := `{"content":"` + strings.Repeat("a", 1001) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/messages/send/2", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for too long message, got %d", w.Code)
	}

	var count int64
	if err := db.Model(&models.Message{}).Count(&count).Error; err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no messages to be created, got %d", count)
	}
}

func TestPatchUserResetsEmailVerificationOnEmailChange(t *testing.T) {
	db := testDB(t)
	user := models.User{
		ID:              1,
		Name:            "Alice",
		Email:           "alice@example.com",
		Password:        "hash",
		IsEmailVerified: true,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	r := routerWithUser(1)
	r.PATCH("/users/:id", PatchUser(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/users/1", strings.NewReader(`{"email":"alice-new@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for email change, got %d", w.Code)
	}

	var updated models.User
	if err := db.First(&updated, 1).Error; err != nil {
		t.Fatalf("load user: %v", err)
	}
	if updated.IsEmailVerified {
		t.Fatal("expected email verification to be reset")
	}
}

func TestWebSocketRejectsQueryToken(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.GET("/ws", WebSocketHandler)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws?token=abc", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for query token, got %d", w.Code)
	}
}

func TestRegisterRejectsHoneypot(t *testing.T) {
	db := testDB(t)

	r := gin.New()
	r.POST("/auth/register", Register(db))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/auth/register",
		strings.NewReader(`{"name":"Bot","email":"bot@example.com","password":"secret123","website":"https://spam.example"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for honeypot registration, got %d", w.Code)
	}

	var count int64
	if err := db.Model(&models.User{}).Where("email = ?", "bot@example.com").Count(&count).Error; err != nil {
		t.Fatalf("count users: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected honeypot registration to create no users, got %d", count)
	}
}
