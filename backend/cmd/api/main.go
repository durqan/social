package main

import (
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/handlers"
	"tester/internal/middleware"
	"tester/internal/models"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/mattn/go-sqlite3"
)

func main() {
	cfg := config.Load()
	database, err := db.NewDB()
	if err != nil {
		panic("failed to connect database")
	}

	err = database.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.Like{},
		&models.Comment{},
		&models.Message{},
		&models.Friendship{})

	if err != nil {
		panic("failed to migrate database")
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	auth := r.Group("/auth")
	{
		auth.POST("/register", handlers.Register(database))
		auth.POST("/login", handlers.Login(database))
		auth.POST("/logout", handlers.Logout())
	}

	users := r.Group("/users")
	users.Use(middleware.AuthMiddleware())
	{
		users.POST("", handlers.CreateUser(database))
		users.GET("", handlers.GetUsers(database))
		users.GET("/:id", handlers.GetUser(database))
		users.PATCH("/:id", handlers.PatchUser(database))
		users.DELETE("/:id", handlers.DeleteUser(database))
		users.GET("/profile", handlers.GetProfile(database))
		users.PATCH("/:id/password", handlers.ChangePassword(database))
		users.GET("/search", handlers.SearchUsersByNameOrEmail(database))

		friends := users.Group("/friends")
		{
			friends.GET("/list", handlers.GetFriendsList(database))
			friends.GET("/requests", handlers.GetFriendRequests(database))
			friends.GET("/status/:id", handlers.GetFriendshipStatus(database))
			friends.POST("/request/:id", handlers.SendFriendRequest(database))
			friends.PATCH("/:id/accept", handlers.AcceptFriendRequest(database))
			friends.DELETE("/:id", handlers.RemoveFriend(database))
			friends.POST("/:id/block", handlers.BlockUser(database))
		}
	}

	posts := r.Group("/posts")
	posts.Use(middleware.AuthMiddleware())
	{
		posts.GET("", handlers.GetPosts(database))
		posts.POST("", handlers.CreatePost(database))
		posts.PATCH("/:id", handlers.UpdatePost(database))
		posts.DELETE("/:id", handlers.DeletePost(database))
		posts.POST("/:id/like", handlers.ToggleLike(database))
		posts.GET("/:id/comments", handlers.GetComments(database))
		posts.POST("/:id/comments", handlers.CreateComment(database))
	}

	messages := r.Group("/messages")
	messages.Use(middleware.AuthMiddleware())
	{
		messages.GET("/conversations", handlers.GetConversations(database))
		messages.GET("/with/:userId", handlers.GetMessagesWith(database))
		messages.POST("/send/:toId", handlers.SendMessage(database))
		messages.PATCH("/:messageId", handlers.UpdateMessage(database))
		messages.DELETE("/:messageId", handlers.DeleteMessage(database))
		messages.DELETE("/batch", handlers.DeleteMessagesBatch(database))
		messages.GET("/unread/count", handlers.GetUnreadCount(database))
		messages.PATCH("/read/:userId", handlers.MarkMessagesAsRead(database))
	}

	handlers.InitWebSocket(database)
	r.GET("/ws", handlers.WebSocketHandler)

	if err := r.Run(":" + cfg.Port); err != nil {
		panic(err)
	}
}
