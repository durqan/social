package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"notifications/hub"
	"notifications/models"
	"notifications/repository"
	"notifications/services"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSubscribePushUsesAuthenticatedUserID(t *testing.T) {
	database := newPushHandlerTestDB(t)
	handler := NewHandler(
		services.NewService(repository.NewRepository(database), hub.NewHub(), nil),
		hub.NewHub(),
	)
	context, recorder := newPushHandlerContext(
		http.MethodPost,
		`{"user_id":99,"endpoint":"https://push.example/endpoint","keys":{"p256dh":"key","auth":"auth"}}`,
	)
	context.Set("user_id", uint(10))

	handler.SubscribePush(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var subscription models.PushSubscription
	if err := database.First(&subscription).Error; err != nil {
		t.Fatalf("load subscription: %v", err)
	}
	if subscription.UserID != 10 {
		t.Fatalf("subscription user_id = %d, want authenticated user 10", subscription.UserID)
	}
}

func TestSubscribePushRequiresAuthentication(t *testing.T) {
	database := newPushHandlerTestDB(t)
	handler := NewHandler(
		services.NewService(repository.NewRepository(database), hub.NewHub(), nil),
		hub.NewHub(),
	)
	context, recorder := newPushHandlerContext(
		http.MethodPost,
		`{"endpoint":"https://push.example/endpoint","keys":{"p256dh":"key","auth":"auth"}}`,
	)

	handler.SubscribePush(context)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	var count int64
	if err := database.Model(&models.PushSubscription{}).Count(&count).Error; err != nil {
		t.Fatalf("count subscriptions: %v", err)
	}
	if count != 0 {
		t.Fatalf("unauthenticated request created %d subscriptions", count)
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
	if err := database.AutoMigrate(&models.PushSubscription{}); err != nil {
		t.Fatalf("migrate push subscriptions: %v", err)
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
