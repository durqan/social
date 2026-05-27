package handlers

import (
	"tester/internal/dto"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TogglePostLike(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}

		post, err := repository.GetPostByID(db, postID)
		if err != nil {
			c.JSON(404, gin.H{"error": "post not found"})
			return
		}

		isLiked, err := repository.TogglePostLike(db, postID, userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to toggle like"})
			return
		}

		likesCount, _ := repository.GetPostLikeCount(db, postID)

		if isLiked {
			publishNotification(post.UserID, userID, dto.NotificationTypePostLiked, postID)
		}

		c.JSON(200, gin.H{
			"is_liked":    isLiked,
			"likes_count": likesCount,
		})
	}
}

func ToggleCommentLike(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}
		commentID, ok := uintParam(c, "commentID", "invalid comment id")
		if !ok {
			return
		}

		comment, err := repository.GetCommentByID(db, commentID)
		if err != nil || comment.PostID != postID {
			c.JSON(404, gin.H{"error": "comment not found"})
			return
		}

		isLiked, err := repository.ToggleCommentLike(db, commentID, userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to toggle like"})
			return
		}

		likesCount, _ := repository.GetCommentLikeCount(db, commentID)

		c.JSON(200, gin.H{
			"is_liked":    isLiked,
			"likes_count": likesCount,
		})
	}
}
