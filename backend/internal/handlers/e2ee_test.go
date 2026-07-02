package handlers

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"tester/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSaveE2EEBackupPersistsAuthenticatedUserKey(t *testing.T) {
	database := newE2EEHandlerTestDB(t)
	context, recorder := newE2EEHandlerContext(
		http.MethodPost,
		`{"user_id":2,"encrypted_master_key":"{\"publicKey\":\"user-1\"}"}`,
	)
	context.Set("user_id", uint(1))

	SaveE2EEBackup(database)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != `{"enabled":true,"public_key":"user-1"}` {
		t.Fatalf("body = %s, want enabled response", recorder.Body.String())
	}
	var backup models.EncryptedKeyBackup
	if err := database.Where("user_id = ?", 1).First(&backup).Error; err != nil {
		t.Fatalf("load saved backup: %v", err)
	}
	if backup.EncryptedMasterKey != `{"publicKey":"user-1"}` {
		t.Fatalf("backup = %q, want user-1 backup", backup.EncryptedMasterKey)
	}
}

func TestGetE2EEBackupCannotReadAnotherUsersBackup(t *testing.T) {
	database := newE2EEHandlerTestDB(t)
	if err := database.Create(&models.EncryptedKeyBackup{
		UserID:             2,
		EncryptedMasterKey: `{"publicKey":"user-2"}`,
	}).Error; err != nil {
		t.Fatalf("seed backup: %v", err)
	}
	context, recorder := newE2EEHandlerContext(http.MethodGet, "")
	context.Set("user_id", uint(1))
	context.Request.URL.RawQuery = "user_id=2"

	GetE2EEBackup(database)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != `{"enabled":false,"encrypted_master_key":null}` {
		t.Fatalf("foreign backup leaked: %s", recorder.Body.String())
	}
}

func TestGetE2EEBackupReturnsAuthenticatedUsersBackup(t *testing.T) {
	database := newE2EEHandlerTestDB(t)
	if err := database.Create(&models.EncryptedKeyBackup{
		UserID:             1,
		EncryptedMasterKey: `{"publicKey":"user-1"}`,
	}).Error; err != nil {
		t.Fatalf("seed backup: %v", err)
	}
	context, recorder := newE2EEHandlerContext(http.MethodGet, "")
	context.Set("user_id", uint(1))

	GetE2EEBackup(database)(context)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() != `{"enabled":true,"encrypted_master_key":"{\"publicKey\":\"user-1\"}"}` {
		t.Fatalf("backup response = %s", recorder.Body.String())
	}
}

func TestSaveE2EEBackupRequiresAuthentication(t *testing.T) {
	database := newE2EEHandlerTestDB(t)
	context, recorder := newE2EEHandlerContext(
		http.MethodPost,
		`{"encrypted_master_key":"{\"publicKey\":\"unauthorized\"}"}`,
	)

	SaveE2EEBackup(database)(context)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	var count int64
	if err := database.Model(&models.EncryptedKeyBackup{}).Count(&count).Error; err != nil {
		t.Fatalf("count backups: %v", err)
	}
	if count != 0 {
		t.Fatalf("unauthenticated request created %d backups", count)
	}
}

func newE2EEHandlerTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(&models.User{}, &models.EncryptedKeyBackup{}); err != nil {
		t.Fatalf("migrate E2EE handler database: %v", err)
	}
	if err := database.Create(&[]models.User{
		{ID: 1, Name: "User 1", Email: "handler1@example.com", Password: "hash"},
		{ID: 2, Name: "User 2", Email: "handler2@example.com", Password: "hash"},
	}).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}
	return database
}

func newE2EEHandlerContext(method string, body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(method, "/", bytes.NewBufferString(body))
	context.Request.Header.Set("Content-Type", "application/json")
	return context, recorder
}
