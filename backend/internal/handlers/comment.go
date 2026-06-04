package handlers

import (
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetComments(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}

		if _, err := repository.GetPostByID(db, postID); err != nil {
			c.JSON(404, gin.H{"error": "post not found"})
			return
		}

		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		comments, err := repository.GetCommentsByPostID(db, postID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch comments"})
			return
		}

		c.JSON(200, buildCommentResponses(db, comments, currentUserID))
	}
}

func CreateComment(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}

		var req struct {
			Content string `json:"content" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		post, err := repository.GetPostByID(db, postID)
		if err != nil {
			c.JSON(404, gin.H{"error": "post not found"})
			return
		}

		content, ok := trimAndValidateContent(req.Content, maxCommentContentLength)
		if !ok {
			c.JSON(400, gin.H{"error": "comment content must be between 1 and 500 characters"})
			return
		}

		comment := models.Comment{
			PostID:  postID,
			UserID:  userID,
			Content: content,
		}

		if err := repository.CreateComment(db, &comment); err != nil {
			c.JSON(500, gin.H{"error": "failed to create comment"})
			return
		}

		publishNotification(post.UserID, userID, dto.NotificationTypeCommentCreated, comment.ID)

		db.Preload("User").First(&comment, comment.ID)
		c.JSON(201, buildCommentResponse(db, comment, userID))
	}
}
