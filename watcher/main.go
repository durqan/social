package main

import (
	"os"
	"strings"
	"watcher_back/handlers"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	allowedOrigins := loadAllowedOrigins()
	handlers.ConfigureAllowedOrigins(allowedOrigins)

	r.Use(cors.New(cors.Config{
		AllowOrigins:     allowedOrigins,
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
	}))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})
	r.POST("/rooms", handlers.CreateRoom())
	r.GET("/rooms/:roomId", handlers.GetRoom())
	r.GET("/rooms/:roomId/status", handlers.GetRoomStatus())
	r.GET("/ws/:roomId", handlers.JoinRoom())

	r.Run(":8082")
}

func loadAllowedOrigins() []string {
	raw := os.Getenv("WATCHER_ALLOWED_ORIGINS")
	if raw == "" {
		raw = os.Getenv("CORS_ALLOWED_ORIGINS")
	}
	if raw == "" {
		raw = os.Getenv("FRONTEND_URL")
	}
	if raw == "" {
		return []string{"http://localhost:5174", "http://localhost:5173", "http://localhost:5175"}
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}
