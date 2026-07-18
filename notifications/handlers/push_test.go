package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"notifications/models"
	"notifications/repository"
	"notifications/services"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRegisterMobilePushTokenUsesAuthenticatedUserID(t *testing.T) {
	database := newPushHandlerTestDB(t)
	handler := NewHandler(services.NewService(repository.NewRepository(database), nil))
	context, recorder := newPushHandlerContext(
		http.MethodPost,
		`{"user_id":99,"provider":"fcm","platform":"android","token":"mobile-token"}`,
	)
	context.Set("user_id", uint(10))

	handler.RegisterMobilePushToken(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var token models.MobilePushToken
	if err := database.First(&token).Error; err != nil {
		t.Fatalf("load mobile token: %v", err)
	}
	if token.UserID != 10 {
		t.Fatalf("mobile token user_id = %d, want authenticated user 10", token.UserID)
	}
}

func TestRevokeMobilePushTokenOnlyCurrentUser(t *testing.T) {
	database := newPushHandlerTestDB(t)
	if err := database.Create(&[]models.MobilePushToken{
		{UserID: 10, Provider: "fcm", Platform: "android", Token: "current-user-token"},
		{UserID: 11, Provider: "fcm", Platform: "android", Token: "other-user-token"},
	}).Error; err != nil {
		t.Fatalf("seed mobile tokens: %v", err)
	}
	handler := NewHandler(services.NewService(repository.NewRepository(database), nil))
	context, recorder := newPushHandlerContext(
		http.MethodDelete,
		`{"provider":"fcm","platform":"android","token":"other-user-token"}`,
	)
	context.Set("user_id", uint(10))

	handler.RevokeMobilePushToken(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var otherToken models.MobilePushToken
	if err := database.First(&otherToken, "token = ?", "other-user-token").Error; err != nil {
		t.Fatalf("load other mobile token: %v", err)
	}
	if otherToken.RevokedAt != nil {
		t.Fatal("revoke endpoint revoked another user's token")
	}
}

func newPushHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(&models.MobilePushToken{}); err != nil {
		t.Fatalf("migrate mobile push tokens: %v", err)
	}
	return database
}

func newPushHandlerContext(method string, body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	context.Request.Header.Set("Content-Type", "application/json")
	return context, recorder
}
