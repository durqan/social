package main

import (
	"audit/handlers"
	"audit/middleware"
	"audit/models"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println(".env not found")
	}

	dataBaseURL := os.Getenv("DATABASE_URL")
	if dataBaseURL == "" {
		log.Fatal("DATABASE_URL is empty")
	}

	db, err := gorm.Open(postgres.Open(dataBaseURL), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}

	err = db.AutoMigrate(&models.AuditEvent{})
	if err != nil {
		log.Fatal("failed to migrate database:", err)
	}

	r := gin.Default()

	auditHandler := handlers.NewAuditHandler(db)

	r.GET("/health", handlers.HealthCheck)

	internal := r.Group("/internal")
	internal.Use(middleware.InternalToken())
	{
		internal.POST("/audit", auditHandler.CreateAuditEvent)
		internal.GET("/audit", auditHandler.GetAuditEvents)
	}

	err = r.Run(":8086")
	if err != nil {
		log.Fatal("failed to up server:", err)
	}
}
