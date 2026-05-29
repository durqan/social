package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"notifications/auth"
	"notifications/db"
	"notifications/handlers"
	"notifications/hub"
	"notifications/models"
	pushsvc "notifications/push"
	"notifications/rabbit"
	"notifications/repository"
	"notifications/services"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println(".env not found")
	}

	newDB, err := db.NewDB()
	if err != nil {
		log.Fatal(err)
	}
	err = newDB.AutoMigrate(&models.Notification{}, &models.PushSubscription{})
	if err != nil {
		log.Fatal(err)
	}

	repo := repository.NewRepository(newDB)
	notificationHub := hub.NewHub()
	pushService := pushsvc.NewServiceFromEnv()
	svc := services.NewService(repo, notificationHub, pushService)
	h := handlers.NewHandler(svc, notificationHub)

	conn, ch, err := rabbit.NewRabbit()
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()
	defer ch.Close()

	r := gin.Default()
	r.Use(func(c *gin.Context) {
		if origin := c.GetHeader("Origin"); originAllowed(origin) {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	protected := r.Group("/", auth.Middleware())
	protected.GET("/notifications/stream", h.StreamNotifications)
	protected.GET("/notifications", h.GetUserNotifications)
	protected.GET("/notifications/:user_id/stream", h.StreamNotifications)
	protected.GET("/notifications/:user_id", h.GetUserNotifications)
	protected.PATCH("/notifications/:id/read", h.MarkAsRead)
	protected.POST("/notifications", h.CreateNotification)
	protected.POST("/push/subscribe", h.SubscribePush)

	go func() {
		if err := rabbit.StartConsumer(ch, svc); err != nil {
			log.Fatal(err)
		}
	}()

	if err = r.Run(":8085"); err != nil {
		log.Fatal(err)
	}
}

func originAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, allowed := range allowedOrigins() {
		if origin == allowed {
			return true
		}
	}
	return false
}

func allowedOrigins() []string {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	if raw == "" {
		raw = os.Getenv("FRONTEND_URL")
	}
	if raw == "" {
		return []string{"http://localhost:5173", "http://localhost:5174", "http://localhost:5175"}
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
