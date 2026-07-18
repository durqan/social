package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"notifications/auth"
	"notifications/cache"
	"notifications/db"
	"notifications/handlers"
	"notifications/messagecrypto"
	"notifications/middleware"
	pushsvc "notifications/push"
	"notifications/repository"
	"notifications/services"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println(".env not found")
	}
	if os.Getenv("GIN_MODE") == "release" {
		if err := messagecrypto.ValidateProductionKey(); err != nil {
			log.Fatal(err)
		}
	}

	newDB, err := db.NewDB()
	if err != nil {
		log.Fatal(err)
	}
	if err = db.Migrate(newDB); err != nil {
		log.Fatal(err)
	}

	repo := repository.NewRepository(newDB)
	pushService := pushsvc.NewServiceFromEnv()
	svc := services.NewService(repo, pushService)
	defer svc.Close()
	h := handlers.NewHandler(svc)

	if err := cache.InitRedis(); err != nil {
		log.Fatal("failed to connect redis:", err)
	}
	log.Println("Redis connected successfully")

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/notifications", auth.InternalMiddleware(), h.CreateNotification)

	protected := r.Group("/", auth.Middleware())
	protected.GET("/notifications", h.GetUserNotifications)
	protected.PATCH("/notifications/seen", h.MarkAsSeen)
	protected.PATCH("/notifications/read-matching", h.MarkMatchingAsRead)
	protected.PATCH("/notifications/:id/read", h.MarkAsRead)
	protected.POST("/push/mobile-token", middleware.RateLimit(20, time.Hour), h.RegisterMobilePushToken)
	protected.DELETE("/push/mobile-token", middleware.RateLimit(20, time.Hour), h.RevokeMobilePushToken)

	server := &http.Server{Addr: ":8085", Handler: r}
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err = <-serverErrors:
		if err != nil && err != http.ErrServerClosed {
			log.Printf("notifications server stopped: %v", err)
		}
		return
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("notifications server shutdown failed: %v", err)
	}
}
