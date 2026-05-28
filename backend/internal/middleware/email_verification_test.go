package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tester/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRequireVerifiedEmailBlocksUnverifiedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db := testMiddlewareDB(t)
	user := models.User{ID: 1, Name: "Alice", Email: "alice@example.com", Password: "hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Next()
	})
	router.POST("/protected", RequireVerifiedEmail(db), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/protected", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), EmailVerificationRequiredMessage) {
		t.Fatalf("expected verification error, got %q", w.Body.String())
	}
}

func TestRequireVerifiedEmailAllowsVerifiedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db := testMiddlewareDB(t)
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

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", uint(1))
		c.Next()
	})
	router.POST("/protected", RequireVerifiedEmail(db), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/protected", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}

func testMiddlewareDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}
