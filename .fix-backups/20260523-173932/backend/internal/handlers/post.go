package handlers

import (
	_ "errors"
	"strconv"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type PostResponse struct {
	ID            uint        `json:"id"`
	Content       string      `json:"content"`
	CreatedAt     string      `json:"created_at"`
	UpdatedAt     string      `json:"updated_at"`
	User          models.User `json:"user"`
	LikesCount    int64       `json:"likes_count"`
	CommentsCount int64       `json:"comments_count"`
	IsLiked       bool        `json:"is_liked"`
}

type CommentResponse struct {
	ID         uint        `json:"id"`
	Content    string      `json:"content"`
	CreatedAt  string      `json:"created_at"`
	UpdatedAt  string      `json:"updated_at"`
	User       models.User `json:"user"`
	PostID     uint        `json:"post_id"`
	LikesCount int64       `json:"likes_count"`
	IsLiked    bool        `json:"is_liked"`
}

func GetPosts(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		currentUserID := userID.(uint)

		posts, err := repository.GetPostsByUser(db, currentUserID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch posts"})
			return
		}

		var response []PostResponse
		for _, post := range posts {
			likesCount, _ := repository.GetPostLikeCount(db, post.ID)
			commentsCount, _ := repository.GetPostCommentCount(db, post.ID)
			isLiked, _ := repository.IsPostLikedByUser(db, post.ID, currentUserID)

			response = append(response, PostResponse{
				ID:            post.ID,
				Content:       post.Content,
				CreatedAt:     post.CreatedAt.Format("2006-01-02 15:04:05"),
				UpdatedAt:     post.UpdatedAt.Format("2006-01-02 15:04:05"),
				User:          post.User,
				LikesCount:    likesCount,
				CommentsCount: commentsCount,
				IsLiked:       isLiked,
			})
		}

		c.JSON(200, response)
	}
}

func CreatePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")

		var req struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		post := models.Post{
			UserID:  userID.(uint),
			Content: req.Content,
		}

		if err := repository.CreatePost(db, &post); err != nil {
			c.JSON(500, gin.H{"error": "failed to create post"})
			return
		}

		db.Preload("User").First(&post, post.ID)
		c.JSON(201, post)
	}
}

func UpdatePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		postID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid post id"})
			return
		}

		if !repository.IsPostOwner(db, uint(postID), userID.(uint)) {
			c.JSON(403, gin.H{"error": "you can only edit your own posts"})
			return
		}

		var req struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if err := repository.UpdatePost(db, uint(postID), req.Content); err != nil {
			c.JSON(500, gin.H{"error": "failed to update post"})
			return
		}

		post, _ := repository.GetPostByID(db, uint(postID))
		c.JSON(200, post)
	}
}

func DeletePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		postID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid post id"})
			return
		}

		if !repository.IsPostOwner(db, uint(postID), userID.(uint)) {
			c.JSON(403, gin.H{"error": "you can only delete your own posts"})
			return
		}

		repository.DeletePostComments(db, uint(postID))
		repository.DeletePostLikes(db, uint(postID))

		if err := repository.DeletePost(db, uint(postID)); err != nil {
			c.JSON(500, gin.H{"error": "failed to delete post"})
			return
		}

		c.JSON(200, gin.H{"message": "post deleted successfully"})
	}
}

func TogglePostLike(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		postID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid post id"})
			return
		}

		isLiked, err := repository.TogglePostLike(db, uint(postID), userID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to toggle like"})
			return
		}

		likesCount, _ := repository.GetPostLikeCount(db, uint(postID))

		c.JSON(200, gin.H{
			"is_liked":    isLiked,
			"likes_count": likesCount,
		})
	}
}

func ToggleCommentLike(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		commentID, err := strconv.ParseUint(c.Param("commentID"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid comment id"})
			return
		}

		isLiked, err := repository.ToggleCommentLike(db, uint(commentID), userID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to toggle like"})
			return
		}

		likesCount, _ := repository.GetCommentLikeCount(db, uint(commentID))

		c.JSON(200, gin.H{
			"is_liked":    isLiked,
			"likes_count": likesCount,
		})
	}
}

func GetComments(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		postID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid post id"})
			return
		}

		userID, _ := c.Get("user_id")
		currentUserID := userID.(uint)

		comments, err := repository.GetCommentsByPostID(db, uint(postID))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch comments"})
			return
		}

		var response []CommentResponse
		for _, comment := range comments {
			likesCount, _ := repository.GetCommentLikeCount(db, comment.ID)
			isLiked, _ := repository.IsCommentLikedByUser(db, comment.ID, currentUserID)

			response = append(response, CommentResponse{
				ID:         comment.ID,
				Content:    comment.Content,
				CreatedAt:  comment.CreatedAt.Format("2006-01-02 15:04:05"),
				User:       comment.User,
				PostID:     comment.PostID,
				LikesCount: likesCount,
				IsLiked:    isLiked,
			})
		}

		c.JSON(200, response)
	}
}

func CreateComment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		postID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid post id"})
			return
		}

		var req struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		comment := models.Comment{
			PostID:  uint(postID),
			UserID:  userID.(uint),
			Content: req.Content,
		}

		if err := repository.CreateComment(db, &comment); err != nil {
			c.JSON(500, gin.H{"error": "failed to create comment"})
			return
		}

		db.Preload("User").First(&comment, comment.ID)
		c.JSON(201, comment)
	}
}
