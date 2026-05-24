package handlers

import (
	"tester/internal/models"
	"tester/internal/repository"

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

func buildPostResponse(db *gorm.DB, post models.Post, currentUserID uint) PostResponse {
	likesCount, _ := repository.GetPostLikeCount(db, post.ID)
	commentsCount, _ := repository.GetPostCommentCount(db, post.ID)
	isLiked, _ := repository.IsPostLikedByUser(db, post.ID, currentUserID)

	return PostResponse{
		ID:            post.ID,
		Content:       post.Content,
		CreatedAt:     post.CreatedAt.Format("2006-01-02 15:04:05"),
		UpdatedAt:     post.UpdatedAt.Format("2006-01-02 15:04:05"),
		User:          post.User,
		LikesCount:    likesCount,
		CommentsCount: commentsCount,
		IsLiked:       isLiked,
	}
}

func buildPostResponses(db *gorm.DB, posts []models.Post, currentUserID uint) []PostResponse {
	response := make([]PostResponse, 0, len(posts))
	for _, post := range posts {
		response = append(response, buildPostResponse(db, post, currentUserID))
	}

	return response
}

func buildCommentResponse(db *gorm.DB, comment models.Comment, currentUserID uint) CommentResponse {
	likesCount, _ := repository.GetCommentLikeCount(db, comment.ID)
	isLiked, _ := repository.IsCommentLikedByUser(db, comment.ID, currentUserID)

	return CommentResponse{
		ID:         comment.ID,
		Content:    comment.Content,
		CreatedAt:  comment.CreatedAt.Format("2006-01-02 15:04:05"),
		User:       comment.User,
		PostID:     comment.PostID,
		LikesCount: likesCount,
		IsLiked:    isLiked,
	}
}

func buildCommentResponses(db *gorm.DB, comments []models.Comment, currentUserID uint) []CommentResponse {
	response := make([]CommentResponse, 0, len(comments))
	for _, comment := range comments {
		response = append(response, buildCommentResponse(db, comment, currentUserID))
	}

	return response
}
