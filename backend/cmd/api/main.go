package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/handlers"
	"tester/internal/notifications"
	"tester/internal/server"
	"tester/internal/services"
	"tester/internal/storage"
)

func main() {
	cfg := config.Load()
	signalCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	runtimeCtx, cancelRuntime := context.WithCancel(context.Background())
	defer cancelRuntime()

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

	log.Println("Redis connected successfully")

	if err := db.Migrate(database); err != nil {
		log.Fatal("failed to migrate database:", err)
	}

	notificationService := notifications.NewService(database, handlers.IsConversationActive)
	outboxDone := services.StartNotificationOutboxWorker(runtimeCtx, database, notificationService)
	services.StartUnverifiedUserCleanup(database)
	services.StartAbandonedUploadCleanup(database)

	router := server.NewRouter(runtimeCtx, database, notificationService)
	messageUpdatesDone := handlers.StartMessageUpdateSubscriber(runtimeCtx, database)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	serverErrors := make(chan error, 1)

	log.Printf("Server starting on port %s", cfg.Port)
	go func() {
		serverErrors <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server stopped: %v", err)
		}
		stop()
	case <-signalCtx.Done():
	}

	handlers.ShutdownWebSockets()
	cancelRuntime()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown failed: %v", err)
	}
	waitForWorker("notification outbox", outboxDone)
	waitForWorker("message update subscriber", messageUpdatesDone)
}

func waitForWorker(name string, done <-chan struct{}) {
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		log.Printf("timed out waiting for %s shutdown", name)
	}
}
