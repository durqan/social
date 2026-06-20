package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/services"
	"tester/internal/storage"
)

func main() {
	cfg := config.Load()

	if _, err := storage.Default(); err != nil {
		log.Fatal("failed to configure storage:", err)
	}
	database, err := db.NewDB(cfg)
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}
	if err := cache.InitRedis(&cfg); err != nil {
		log.Fatal("failed to connect redis:", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	concurrency := 1
	if raw := os.Getenv("VIDEO_IMPORT_WORKER_CONCURRENCY"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			concurrency = parsed
		}
	}
	tempRoot := os.Getenv("VIDEO_IMPORT_TEMP_ROOT")

	log.Printf("video import worker starting with concurrency=%d", concurrency)
	if err := services.RunVideoImportWorker(ctx, database, services.VideoImportWorkerConfig{
		RabbitURL:   cfg.RabbitURL,
		Concurrency: concurrency,
		TempRoot:    tempRoot,
	}); err != nil && err != context.Canceled {
		log.Fatal(err)
	}
}
