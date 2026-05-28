package main

import (
	"watcher_back/handlers"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5174", "http://localhost:5173", "http://localhost:5175"},
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept"},
		AllowCredentials: true,
	}))

	r.POST("/rooms", handlers.CreateRoom())
	r.GET("/rooms/:roomId", handlers.GetRoom())
	r.GET("/rooms/:roomId/status", handlers.GetRoomStatus())
	r.GET("/ws/:roomId", handlers.JoinRoom())

	r.Run(":8082")
}
