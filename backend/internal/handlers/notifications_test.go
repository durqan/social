package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"tester/internal/models"
	"tester/internal/notifications"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRegisterMobilePushTokenUsesAuthenticatedUser(t *testing.T) {
	database := newNotificationHandlerTestDB(t)
	service := notifications.NewService(database)
	context, recorder := newNotificationHandlerContext(
		http.MethodPost,
		`{"user_id":99,"provider":"fcm","platform":"android","token":"mobile-token"}`,
	)
	context.Set("user_id", uint(10))

	RegisterMobilePushToken(service)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var token models.MobilePushToken
	if err := database.First(&token).Error; err != nil {
		t.Fatalf("load token: %v", err)
	}
	if token.UserID != 10 {
		t.Fatalf("token user_id = %d, want 10", token.UserID)
	}
}

func TestRevokeMobilePushTokenCannotRevokeAnotherUsersToken(t *testing.T) {
	database := newNotificationHandlerTestDB(t)
	if err := database.Create(&models.MobilePushToken{
		UserID:   11,
		Provider: "fcm",
		Platform: "android",
		Token:    "other-token",
	}).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	service := notifications.NewService(database)
	context, recorder := newNotificationHandlerContext(
		http.MethodDelete,
		`{"provider":"fcm","platform":"android","token":"other-token"}`,
	)
	context.Set("user_id", uint(10))

	RevokeMobilePushToken(service)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var token models.MobilePushToken
	if err := database.First(&token).Error; err != nil {
		t.Fatalf("load token: %v", err)
	}
	if token.RevokedAt != nil {
		t.Fatal("another user's token was revoked")
	}
}

func newNotificationHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(
		&models.Notification{},
		&models.MobilePushToken{},
	); err != nil {
		t.Fatalf("migrate handler database: %v", err)
	}
	return database
}

func newNotificationHandlerContext(
	method string,
	body string,
) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	context.Request.Header.Set("Content-Type", "application/json")
	return context, recorder
}
