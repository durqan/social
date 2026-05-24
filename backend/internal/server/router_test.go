package server

import (
	"testing"

	"tester/internal/config"

	"github.com/gin-gonic/gin"
)

func TestNewRouterRegistersRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	router := NewRouter(nil, config.Config{
		AllowedOrigins: []string{"http://localhost:5173"},
	})

	if len(router.Routes()) == 0 {
		t.Fatal("expected registered routes")
	}
}
