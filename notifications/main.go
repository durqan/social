package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"notifications/auth"
	"notifications/cache"
	"notifications/db"
	"notifications/handlers"
	"notifications/messagecrypto"
	"notifications/middleware"
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

	consumer := rabbit.NewConsumer(svc)
	consumerCtx, stopConsumer := context.WithCancel(context.Background())
	defer stopConsumer()
	go consumer.Start(consumerCtx)

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		rabbitStatus := consumer.Status()
		statusCode := http.StatusOK
		status := "ok"
		if !rabbitStatus.Healthy {
			statusCode = http.StatusServiceUnavailable
			status = "degraded"
		}
		c.JSON(statusCode, gin.H{
			"status":          status,
			"rabbit_consumer": rabbitStatus,
		})
	})

	r.POST("/notifications", middleware.RateLimit(30, time.Minute), auth.InternalMiddleware(), h.CreateNotification)

	protected := r.Group("/", auth.Middleware())
	protected.GET("/notifications", h.GetUserNotifications)
	protected.PATCH("/notifications/seen", h.MarkAsSeen)
	protected.PATCH("/notifications/read-matching", h.MarkMatchingAsRead)
	protected.PATCH("/notifications/:id/read", h.MarkAsRead)
	protected.POST("/push/mobile-token", middleware.RateLimit(20, time.Hour), h.RegisterMobilePushToken)
	protected.DELETE("/push/mobile-token", middleware.RateLimit(20, time.Hour), h.RevokeMobilePushToken)

	if err = r.Run(":8085"); err != nil {
		log.Fatal(err)
	}
}
