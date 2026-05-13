package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"tester/internal/auth"
	"tester/internal/middleware"
	"tester/internal/models"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestUserAccessControl(t *testing.T) {
	gin.SetMode(gin.TestMode)

	db := newTestDB(t)
	currentUser := createTestUser(t, db, "Current User", "current@example.com", "password123")
	otherUser := createTestUser(t, db, "Other User", "other@example.com", "password123")
	router := newUserTestRouter(db)

	t.Run("cannot update another profile", func(t *testing.T) {
		res := performAuthenticatedRequest(t, router, http.MethodPatch, "/users/"+strconv.Itoa(int(otherUser.ID)), currentUser.ID, map[string]string{
			"name": "Changed",
		})

		if res.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
		}

		var reloaded models.User
		if err := db.First(&reloaded, otherUser.ID).Error; err != nil {
			t.Fatal(err)
		}
		if reloaded.Name != otherUser.Name {
			t.Fatalf("expected other user to stay unchanged, got name %q", reloaded.Name)
		}
	})

	t.Run("cannot delete another account", func(t *testing.T) {
		res := performAuthenticatedRequest(t, router, http.MethodDelete, "/users/"+strconv.Itoa(int(otherUser.ID)), currentUser.ID, nil)

		if res.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
		}

		var count int64
		if err := db.Model(&models.User{}).Where("id = ?", otherUser.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("expected other user to remain, found %d rows", count)
		}
	})

	t.Run("cannot change another password", func(t *testing.T) {
		res := performAuthenticatedRequest(t, router, http.MethodPatch, "/users/"+strconv.Itoa(int(otherUser.ID))+"/password", currentUser.ID, map[string]string{
			"current_password": "password123",
			"new_password":     "newpassword123",
		})

		if res.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d: %s", res.Code, res.Body.String())
		}
	})

	t.Run("update ignores blocked fields", func(t *testing.T) {
		res := performAuthenticatedRequest(t, router, http.MethodPatch, "/users/"+strconv.Itoa(int(currentUser.ID)), currentUser.ID, map[string]string{
			"name":     "Updated User",
			"password": "plaintext-password",
		})

		if res.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", res.Code, res.Body.String())
		}

		var reloaded models.User
		if err := db.First(&reloaded, currentUser.ID).Error; err != nil {
			t.Fatal(err)
		}
		if reloaded.Name != "Updated User" {
			t.Fatalf("expected name update, got %q", reloaded.Name)
		}
		if reloaded.Password == "plaintext-password" {
			t.Fatal("password field was updated through profile patch")
		}
	})
}

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{TranslateError: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func newUserTestRouter(db *gorm.DB) *gin.Engine {
	router := gin.New()
	users := router.Group("/users")
	users.Use(middleware.AuthMiddleware())
	{
		users.PATCH("/:id", PatchUser(db))
		users.DELETE("/:id", DeleteUser(db))
		users.PATCH("/:id/password", ChangePassword(db))
	}
	return router
}

func createTestUser(t *testing.T, db *gorm.DB, name, email, password string) models.User {
	t.Helper()

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	user := models.User{Name: name, Email: email, Password: string(hashedPassword)}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	return user
}

func performAuthenticatedRequest(t *testing.T, router *gin.Engine, method, path string, userID uint, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reqBody bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&reqBody).Encode(body); err != nil {
			t.Fatal(err)
		}
	}

	req := httptest.NewRequest(method, path, &reqBody)
	req.Header.Set("Content-Type", "application/json")
	token, err := auth.GenerateToken(userID)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(&http.Cookie{Name: "token", Value: token})

	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	return res
}
