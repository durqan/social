package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGetConversationsUsesHeadCursorPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database := newConversationHandlerTestDB(t)
	base := time.Date(2026, time.July, 15, 15, 0, 0, 0, time.UTC)
	for _, user := range []models.User{
		{ID: 1, Name: "Current", Email: "current@example.com", Password: "hash"},
		{ID: 2, Name: "Peer 2", Email: "peer2@example.com", Password: "hash"},
		{ID: 3, Name: "Peer 3", Email: "peer3@example.com", Password: "hash"},
	} {
		if err := database.Create(&user).Error; err != nil {
			t.Fatalf("create user %d: %v", user.ID, err)
		}
	}
	for index, peerID := range []uint{2, 3} {
		message := models.Message{
			FromID:    peerID,
			ToID:      1,
			Content:   fmt.Sprintf("from peer %d", peerID),
			CreatedAt: base.Add(time.Duration(index) * time.Minute),
			UpdatedAt: base.Add(time.Duration(index) * time.Minute),
		}
		if err := repository.CreateMessage(database, &message); err != nil {
			t.Fatalf("create peer %d message: %v", peerID, err)
		}
	}

	firstRecorder := httptest.NewRecorder()
	firstContext, _ := gin.CreateTestContext(firstRecorder)
	firstContext.Request = httptest.NewRequest(http.MethodGet, "/conversations?limit=1", nil)
	firstContext.Set("user_id", uint(1))
	GetConversations(database)(firstContext)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("first page status = %d body=%s", firstRecorder.Code, firstRecorder.Body.String())
	}
	nextCursor := firstRecorder.Header().Get("X-Next-Cursor")
	if nextCursor == "" {
		t.Fatal("first page response has no X-Next-Cursor")
	}
	firstRows := decodeConversationHandlerRows(t, firstRecorder)
	if len(firstRows) != 1 {
		t.Fatalf("first page rows = %d, want 1", len(firstRows))
	}
	if _, exists := firstRows[0]["conversation_id"]; exists {
		t.Fatalf("first page leaked conversation_id: %+v", firstRows[0])
	}

	secondRecorder := httptest.NewRecorder()
	secondContext, _ := gin.CreateTestContext(secondRecorder)
	secondContext.Request = httptest.NewRequest(
		http.MethodGet,
		"/conversations?limit=1&cursor="+url.QueryEscape(nextCursor),
		nil,
	)
	secondContext.Set("user_id", uint(1))
	GetConversations(database)(secondContext)
	if secondRecorder.Code != http.StatusOK {
		t.Fatalf("second page status = %d body=%s", secondRecorder.Code, secondRecorder.Body.String())
	}
	secondRows := decodeConversationHandlerRows(t, secondRecorder)
	if len(secondRows) != 1 {
		t.Fatalf("second page rows = %d, want 1", len(secondRows))
	}
	if firstRows[0]["user_id"] == secondRows[0]["user_id"] {
		t.Fatalf("cursor pages duplicated peer %v", firstRows[0]["user_id"])
	}
	if secondRecorder.Header().Get("X-Next-Cursor") != "" {
		t.Fatal("last page unexpectedly returned X-Next-Cursor")
	}
}

func TestGetConversationsRejectsInvalidCursor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []string{
		"/conversations?cursor=not-a-valid-cursor",
		"/conversations?cursor=",
		"/conversations?cursor=not-a-valid-cursor&offset=0",
	}
	for _, target := range tests {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Request = httptest.NewRequest(http.MethodGet, target, nil)
			context.Set("user_id", uint(1))
			GetConversations(nil)(context)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d body=%s, want 400", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func TestGetConversationsRejectsOffsetPagination(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/conversations?limit=50&offset=0", nil)
	context.Set("user_id", uint(1))
	GetConversations(nil)(context)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("offset status = %d body=%s, want 400", recorder.Code, recorder.Body.String())
	}
}

func newConversationHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared&_foreign_keys=1", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open conversation handler database: %v", err)
	}
	if err := database.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
		&models.ConversationPin{},
		&models.ConversationHead{},
	); err != nil {
		t.Fatalf("migrate conversation handler database: %v", err)
	}
	return database
}

func decodeConversationHandlerRows(t *testing.T, recorder *httptest.ResponseRecorder) []map[string]interface{} {
	t.Helper()
	var rows []map[string]interface{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode conversation response: %v body=%s", err, recorder.Body.String())
	}
	return rows
}
