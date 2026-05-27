package main

import (
	"log"

	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/rabbit"
	"tester/internal/server"
)

func main() {
	cfg := config.Load()

	database, err := db.NewDB(cfg)
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}

	if err := cache.InitRedis(&cfg); err != nil {
		log.Fatal("failed to connect redis:", err)
	}

	log.Println("Redis connected successfully")

	if err := rabbit.Init(cfg.RabbitURL); err != nil {
		log.Printf("failed to connect rabbitmq: %v", err)
	} else {
		log.Println("RabbitMQ connected successfully")
	}
	defer rabbit.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatal("failed to migrate database:", err)
	}

	router := server.NewRouter(database, cfg)

	log.Printf("Server starting on port %s", cfg.Port)

	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatal("failed to start server:", err)
	}
}
