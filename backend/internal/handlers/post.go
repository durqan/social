package handlers

import (
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type paginatedPostsResponse struct {
	Posts      []PostResponse `json:"posts"`
	HasMore    bool           `json:"has_more"`
	NextOffset int            `json:"next_offset"`
}

func GetPosts(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		limit, offset, paginated, ok := paginationQuery(c)
		if !ok {
			return
		}

		if paginated {
			posts, err := repository.GetPostsByUserPage(db, currentUserID, limit+1, offset)
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to fetch posts"})
				return
			}
			hasMore := len(posts) > limit
			if hasMore {
				posts = posts[:limit]
			}
			c.JSON(200, paginatedPostsResponse{
				Posts:      buildPostResponses(db, posts, currentUserID),
				HasMore:    hasMore,
				NextOffset: offset + len(posts),
			})
			return
		}

		posts, err := repository.GetPostsByUser(db, currentUserID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch posts"})
			return
		}

		c.JSON(200, buildPostResponses(db, posts, currentUserID))
	}
}

func GetPostsByUserID(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		profileUserID, ok := uintParam(c, "userId", "invalid user id")
		if !ok {
			return
		}

		if _, err := repository.GetUserById(db, profileUserID); err != nil {
			c.JSON(404, gin.H{"error": "user not found"})
			return
		}

		limit, offset, paginated, ok := paginationQuery(c)
		if !ok {
			return
		}

		if paginated {
			posts, err := repository.GetPostsByUserPage(db, profileUserID, limit+1, offset)
			if err != nil {
				c.JSON(500, gin.H{"error": "failed to fetch posts"})
				return
			}
			hasMore := len(posts) > limit
			if hasMore {
				posts = posts[:limit]
			}
			c.JSON(200, paginatedPostsResponse{
				Posts:      buildPostResponses(db, posts, currentUserID),
				HasMore:    hasMore,
				NextOffset: offset + len(posts),
			})
			return
		}

		posts, err := repository.GetPostsByUser(db, profileUserID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch posts"})
			return
		}

		c.JSON(200, buildPostResponses(db, posts, currentUserID))
	}
}

func CreatePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
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

		content, ok := trimAndValidateContent(req.Content, maxPostContentLength)
		if !ok {
			c.JSON(400, gin.H{"error": "post content must be between 1 and 500 characters"})
			return
		}

		post := models.Post{
			UserID:  userID,
			Content: content,
		}

		if err := repository.CreatePost(db, &post); err != nil {
			c.JSON(500, gin.H{"error": "failed to create post"})
			return
		}

		db.Preload("User").First(&post, post.ID)
		c.JSON(201, buildPostResponse(db, post, userID))
	}
}

func UpdatePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}

		if !repository.IsPostOwner(db, postID, userID) {
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

		content, ok := trimAndValidateContent(req.Content, maxPostContentLength)
		if !ok {
			c.JSON(400, gin.H{"error": "post content must be between 1 and 500 characters"})
			return
		}

		if err := repository.UpdatePost(db, postID, content); err != nil {
			c.JSON(500, gin.H{"error": "failed to update post"})
			return
		}

		post, _ := repository.GetPostByID(db, postID)
		c.JSON(200, buildPostResponse(db, post, userID))
	}
}

func DeletePost(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		postID, ok := uintParam(c, "id", "invalid post id")
		if !ok {
			return
		}

		if !repository.IsPostOwner(db, postID, userID) {
			c.JSON(403, gin.H{"error": "you can only delete your own posts"})
			return
		}

		repository.DeletePostComments(db, postID)
		repository.DeletePostLikes(db, postID)

		if err := repository.DeletePost(db, postID); err != nil {
			c.JSON(500, gin.H{"error": "failed to delete post"})
			return
		}

		c.JSON(200, gin.H{"message": "post deleted successfully"})
	}
}
