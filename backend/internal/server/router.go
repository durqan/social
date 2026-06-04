package server

import (
	"time"

	"tester/internal/config"
	"tester/internal/handlers"
	"tester/internal/middleware"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func NewRouter(database *gorm.DB, cfg config.Config) *gin.Engine {
	router := gin.Default()
	router.Static("/uploads/avatars", "./uploads/avatars")
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	router.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-CSRF-Token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/avatars/users/:id", handlers.GetUserAvatar(database))

	registerAuthRoutes(router, database)
	registerUserRoutes(router, database)
	registerPostRoutes(router, database)
	registerMessageRoutes(router, database)
	registerWebSocketRoutes(router, database, cfg)

	return router
}

func registerAuthRoutes(router *gin.Engine, database *gorm.DB) {
	auth := router.Group("/auth")

	auth.POST("/register", middleware.RateLimitMiddleware(5, time.Hour), handlers.Register(database))
	auth.POST("/login", middleware.RateLimitMiddleware(10, 10*time.Minute), handlers.Login(database))
	auth.GET("/csrf", handlers.GetCSRFToken())
	auth.POST("/refresh", middleware.CSRFMiddleware(), handlers.Refresh())
	auth.POST("/logout", middleware.CSRFMiddleware(), handlers.Logout())
	auth.GET("/verify-email/:token", handlers.VerifyEmailHandler(database))

	auth.POST(
		"/send-verification",
		middleware.AuthMiddleware(),
		middleware.CSRFMiddleware(),
		middleware.RateLimitMiddleware(3, time.Hour),
		handlers.SendVerificationEmailHandler(database),
	)
}

func registerUserRoutes(router *gin.Engine, database *gorm.DB) {
	users := router.Group(
		"/users",
		middleware.AuthMiddleware(),
		middleware.CSRFMiddleware(),
		middleware.InvalidateCache("cache:/users*", "cache:/friends*"),
	)

	users.GET("", middleware.CacheMiddleware(5*time.Minute), handlers.GetUsers(database))
	users.GET("/profile", middleware.CacheMiddleware(2*time.Minute), handlers.GetProfile(database))
	users.GET("/search", middleware.CacheMiddleware(3*time.Minute), handlers.SearchUsersByNameOrEmail(database))
	registerFriendRoutes(users, database)

	users.GET("/:id", middleware.CacheMiddleware(5*time.Minute), handlers.GetUser(database))
	users.GET("/:id/presence", handlers.GetPresence)
	users.PATCH("/:id", handlers.PatchUser(database))
	users.PATCH("/:id/avatar", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(20, time.Hour), handlers.UploadAvatar(database))
	users.DELETE("/:id", handlers.DeleteUser(database))
	users.PATCH("/:id/password", handlers.ChangePassword(database))
}

func registerFriendRoutes(users *gin.RouterGroup, database *gorm.DB) {
	friends := users.Group("/friends")
	friends.GET("/list", middleware.CacheMiddleware(3*time.Minute), handlers.GetFriendsList(database))
	friends.GET("/requests", middleware.CacheMiddleware(time.Minute), handlers.GetFriendRequests(database))
	friends.GET("/status/:id", handlers.GetFriendshipStatus(database))
	friends.POST("/request/:id", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(20, time.Hour), handlers.SendFriendRequest(database))
	friends.PATCH("/:id/accept", handlers.AcceptFriendRequest(database))
	friends.DELETE("/:id", handlers.RemoveFriend(database))
	friends.POST("/:id/block", handlers.BlockUser(database))
}

func registerPostRoutes(router *gin.Engine, database *gorm.DB) {
	posts := router.Group(
		"/posts",
		middleware.AuthMiddleware(),
		middleware.CSRFMiddleware(),
		middleware.InvalidateCache("cache:/posts*"),
	)

	posts.GET("", middleware.CacheMiddleware(2*time.Minute), handlers.GetPosts(database))
	posts.GET("/user/:userId", middleware.CacheMiddleware(2*time.Minute), handlers.GetPostsByUserID(database))
	posts.GET("/:id/comments", middleware.CacheMiddleware(5*time.Minute), handlers.GetComments(database))
	posts.POST("", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(10, 10*time.Minute), handlers.CreatePost(database))
	posts.PATCH("/:id", handlers.UpdatePost(database))
	posts.DELETE("/:id", handlers.DeletePost(database))
	posts.POST("/:id/like", middleware.RateLimitMiddleware(120, time.Minute), handlers.TogglePostLike(database))
	posts.POST("/:id/comments", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(30, 10*time.Minute), handlers.CreateComment(database))
	posts.POST("/:id/comments/:commentID/like", handlers.ToggleCommentLike(database))
}

func registerMessageRoutes(router *gin.Engine, database *gorm.DB) {
	messages := router.Group(
		"/messages",
		middleware.AuthMiddleware(),
		middleware.CSRFMiddleware(),
		middleware.InvalidateCache("cache:/messages*"),
	)

	messages.GET("/conversations", middleware.CacheMiddleware(time.Minute), handlers.GetConversations(database))
	messages.GET("/with/:userId", middleware.CacheMiddleware(30*time.Second), handlers.GetMessagesWith(database))
	messages.GET("/unread/count", middleware.CacheMiddleware(10*time.Second), handlers.GetUnreadCount(database))
	messages.GET("/uploads/:filename", handlers.GetUploadedMessageImage())
	messages.GET("/attachments/:id", handlers.GetMessageAttachment(database))
	messages.POST("/upload", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(60, time.Hour), handlers.UploadMessageImage(database))
	messages.POST("/upload-voice", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(60, time.Hour), handlers.UploadMessageVoice(database))
	messages.POST("/upload-video-note", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(60, time.Hour), handlers.UploadMessageVideoNote(database))
	messages.POST("/send/:toId", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(30, 10*time.Minute), handlers.SendMessage(database))
	messages.POST("/:messageId/forward", middleware.RequireVerifiedEmail(database), middleware.RateLimitMiddleware(30, 10*time.Minute), handlers.ForwardMessage(database))
	messages.PATCH("/:messageId", handlers.UpdateMessage(database))
	messages.DELETE("/:messageId", handlers.DeleteMessage(database))
	messages.DELETE("/batch", handlers.DeleteMessagesBatch(database))
	messages.PATCH("/read/:userId", handlers.MarkMessagesAsRead(database))
}

func registerWebSocketRoutes(router *gin.Engine, database *gorm.DB, cfg config.Config) {
	handlers.InitWebSocket(database, cfg.AllowedOrigins)
	router.GET("/ws", middleware.RateLimitMiddleware(60, time.Minute), handlers.WebSocketHandler)
}
