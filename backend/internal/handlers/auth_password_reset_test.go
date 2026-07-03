package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestForgotPasswordExistingEmailReturnsNeutralSuccess(t *testing.T) {
	database := newPasswordResetHandlerTestDB(t)
	sentTo := ""
	restoreSender := services.SetEmailSenderForTest(func(to, subject, htmlBody, textBody string) error {
		sentTo = to
		if !strings.Contains(textBody, "/reset-password?token=") {
			t.Fatalf("reset email does not contain reset URL: %s", textBody)
		}
		return nil
	})
	t.Cleanup(restoreSender)

	context, recorder := newPasswordResetHandlerContext(http.MethodPost, `{"email":"reset@example.com"}`)
	ForgotPassword(database)(context)

	assertPasswordResetSuccessResponse(t, recorder, services.ForgotPasswordSuccessMessage)
	if sentTo != "reset@example.com" {
		t.Fatalf("sentTo = %q, want reset@example.com", sentTo)
	}
	var count int64
	if err := database.Model(&models.PasswordResetToken{}).Count(&count).Error; err != nil {
		t.Fatalf("count reset tokens: %v", err)
	}
	if count != 1 {
		t.Fatalf("reset token count = %d, want 1", count)
	}
}

func TestForgotPasswordUnknownEmailReturnsSameSuccess(t *testing.T) {
	database := newPasswordResetHandlerTestDB(t)
	sendCount := 0
	restoreSender := services.SetEmailSenderForTest(func(to, subject, htmlBody, textBody string) error {
		sendCount++
		return nil
	})
	t.Cleanup(restoreSender)

	context, recorder := newPasswordResetHandlerContext(http.MethodPost, `{"email":"missing@example.com"}`)
	ForgotPassword(database)(context)

	assertPasswordResetSuccessResponse(t, recorder, services.ForgotPasswordSuccessMessage)
	if sendCount != 0 {
		t.Fatalf("email sender called %d times for missing email", sendCount)
	}
	var count int64
	if err := database.Model(&models.PasswordResetToken{}).Count(&count).Error; err != nil {
		t.Fatalf("count reset tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("reset token count = %d, want 0", count)
	}
}

func TestResetPasswordWithValidTokenChangesPassword(t *testing.T) {
	database := newPasswordResetHandlerTestDB(t)
	token, err := services.CreatePasswordResetToken(database, 1)
	if err != nil {
		t.Fatalf("create reset token: %v", err)
	}

	context, recorder := newPasswordResetHandlerContext(
		http.MethodPost,
		fmt.Sprintf(`{"token":%q,"password":"new-secret"}`, token),
	)
	ResetPassword(database)(context)

	assertPasswordResetSuccessResponse(t, recorder, "Пароль успешно обновлён")
	if _, err := services.AuthenticateUser(database, "reset@example.com", "new-secret"); err != nil {
		t.Fatalf("new password does not authenticate: %v", err)
	}

	var resetToken models.PasswordResetToken
	if err := database.First(&resetToken).Error; err != nil {
		t.Fatalf("load reset token: %v", err)
	}
	if resetToken.UsedAt == nil {
		t.Fatal("reset token was not marked as used")
	}
}

func TestResetPasswordWithUsedTokenFails(t *testing.T) {
	database := newPasswordResetHandlerTestDB(t)
	token, err := services.CreatePasswordResetToken(database, 1)
	if err != nil {
		t.Fatalf("create reset token: %v", err)
	}
	usedAt := time.Now()
	if _, err := repository.MarkPasswordResetTokenUsed(database, 1, usedAt); err != nil {
		t.Fatalf("mark token used: %v", err)
	}

	context, recorder := newPasswordResetHandlerContext(
		http.MethodPost,
		fmt.Sprintf(`{"token":%q,"password":"new-secret"}`, token),
	)
	ResetPassword(database)(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertPasswordAuthenticates(t, database, "old-secret")
}

func TestResetPasswordWithExpiredTokenFails(t *testing.T) {
	database := newPasswordResetHandlerTestDB(t)
	token := "expired-token"
	if err := repository.CreatePasswordResetToken(
		database,
		1,
		services.HashPasswordResetToken(token),
		time.Now().Add(-time.Minute),
	); err != nil {
		t.Fatalf("create expired token: %v", err)
	}

	context, recorder := newPasswordResetHandlerContext(
		http.MethodPost,
		fmt.Sprintf(`{"token":%q,"password":"new-secret"}`, token),
	)
	ResetPassword(database)(context)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	assertPasswordAuthenticates(t, database, "old-secret")
}

func newPasswordResetHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(&models.User{}, &models.PasswordResetToken{}); err != nil {
		t.Fatalf("migrate password reset handler database: %v", err)
	}

	password, err := bcrypt.GenerateFromPassword([]byte("old-secret"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash test password: %v", err)
	}
	if err := database.Create(&models.User{
		ID:       1,
		Name:     "Reset User",
		Email:    "reset@example.com",
		Password: string(password),
	}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return database
}

func newPasswordResetHandlerContext(method string, body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	context.Request.Header.Set("Content-Type", "application/json")
	return context, recorder
}

func assertPasswordResetSuccessResponse(t *testing.T, recorder *httptest.ResponseRecorder, message string) {
	t.Helper()

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	expectedBody := fmt.Sprintf(`{"message":%q}`, message)
	if recorder.Body.String() != expectedBody {
		t.Fatalf("body = %s, want %s", recorder.Body.String(), expectedBody)
	}
}

func assertPasswordAuthenticates(t *testing.T, database *gorm.DB, password string) {
	t.Helper()

	if _, err := services.AuthenticateUser(database, "reset@example.com", password); err != nil {
		t.Fatalf("password %q does not authenticate: %v", password, err)
	}
}
