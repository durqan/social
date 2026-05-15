package main

import (
	"log"
	"time"

	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/db"
	"tester/internal/handlers"
	"tester/internal/middleware"
	"tester/internal/models"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	cfg := config.Load()

	database, err := db.NewDB()
	if err != nil {
		log.Fatal("failed to connect database:", err)
	}

	if err := cache.InitRedis(&cfg); err != nil {
		log.Fatal("failed to connect redis:", err)
	}

	log.Println("Redis connected successfully")

	err = database.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.Like{},
		&models.Comment{},
		&models.Message{},
		&models.Friendship{},
	)

	if err != nil {
		log.Fatal("failed to migrate database:", err)
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

	// AUTH
	auth := r.Group("/auth")
	{
		auth.POST("/register", handlers.Register(database))
		auth.POST("/login", handlers.Login(database))
		auth.POST("/logout", handlers.Logout())
	}

	// USERS
	users := r.Group("/users")

	users.Use(
		middleware.AuthMiddleware(),
		middleware.InvalidateCache(
			"cache:/users*",
			"cache:/friends*",
		),
	)

	{
		users.POST("", handlers.CreateUser(database))

		users.GET(
			"",
			middleware.CacheMiddleware(5*time.Minute),
			handlers.GetUsers(database),
		)

		users.GET(
			"/:id",
			middleware.CacheMiddleware(5*time.Minute),
			handlers.GetUser(database),
		)

		users.GET(
			"/profile",
			middleware.CacheMiddleware(2*time.Minute),
			handlers.GetProfile(database),
		)

		users.GET(
			"/search",
			middleware.CacheMiddleware(3*time.Minute),
			handlers.SearchUsersByNameOrEmail(database),
		)

		users.PATCH("/:id", handlers.PatchUser(database))
		users.DELETE("/:id", handlers.DeleteUser(database))
		users.PATCH("/:id/password", handlers.ChangePassword(database))

		// FRIENDS
		friends := users.Group("/friends")

		{
			friends.GET(
				"/list",
				middleware.CacheMiddleware(3*time.Minute),
				handlers.GetFriendsList(database),
			)

			friends.GET(
				"/requests",
				middleware.CacheMiddleware(1*time.Minute),
				handlers.GetFriendRequests(database),
			)

			friends.GET(
				"/status/:id",
				handlers.GetFriendshipStatus(database),
			)

			friends.POST("/request/:id", handlers.SendFriendRequest(database))
			friends.PATCH("/:id/accept", handlers.AcceptFriendRequest(database))
			friends.DELETE("/:id", handlers.RemoveFriend(database))
			friends.POST("/:id/block", handlers.BlockUser(database))
		}
	}

	// POSTS
	posts := r.Group("/posts")

	posts.Use(
		middleware.AuthMiddleware(),
		middleware.InvalidateCache(
			"cache:/posts*",
		),
	)

	{
		posts.GET(
			"",
			middleware.CacheMiddleware(2*time.Minute),
			handlers.GetPosts(database),
		)

		posts.GET(
			"/:id/comments",
			middleware.CacheMiddleware(5*time.Minute),
			handlers.GetComments(database),
		)

		posts.POST("", handlers.CreatePost(database))
		posts.PATCH("/:id", handlers.UpdatePost(database))
		posts.DELETE("/:id", handlers.DeletePost(database))

		posts.POST("/:id/like", handlers.ToggleLike(database))
		posts.POST("/:id/comments", handlers.CreateComment(database))
	}

	// MESSAGES
	messages := r.Group("/messages")

	messages.Use(
		middleware.AuthMiddleware(),
		middleware.InvalidateCache(
			"cache:/messages*",
		),
	)

	{
		messages.GET(
			"/conversations",
			middleware.CacheMiddleware(1*time.Minute),
			handlers.GetConversations(database),
		)

		messages.GET(
			"/with/:userId",
			middleware.CacheMiddleware(30*time.Second),
			handlers.GetMessagesWith(database),
		)

		messages.GET(
			"/unread/count",
			middleware.CacheMiddleware(10*time.Second),
			handlers.GetUnreadCount(database),
		)

		messages.POST("/send/:toId", handlers.SendMessage(database))
		messages.PATCH("/:messageId", handlers.UpdateMessage(database))
		messages.DELETE("/:messageId", handlers.DeleteMessage(database))
		messages.DELETE("/batch", handlers.DeleteMessagesBatch(database))
		messages.PATCH("/read/:userId", handlers.MarkMessagesAsRead(database))
	}

	handlers.InitWebSocket(database)

	r.GET("/ws", handlers.WebSocketHandler)

	log.Printf("Server starting on port %s", cfg.Port)

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal("failed to start server:", err)
	}
}
