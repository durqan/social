package main

import (
	"log"
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
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"health": "OK"})
	})
	r.GET("/notifications/:user_id/stream", h.StreamNotifications)
	r.GET("/notifications/:user_id", h.GetUserNotifications)
	r.PATCH("/notifications/:id/read", h.MarkAsRead)
	r.POST("/notifications", h.CreateNotification)
	r.POST("/push/subscribe", h.SubscribePush)

	go func() {
		if err := rabbit.StartConsumer(ch, svc); err != nil {
			log.Fatal(err)
		}
	}()

	if err = r.Run(":8085"); err != nil {
		log.Fatal(err)
	}
}
