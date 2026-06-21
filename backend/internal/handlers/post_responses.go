package handlers

import (
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"

	"gorm.io/gorm"
)

type PostResponse struct {
	ID            uint                   `json:"id"`
	Content       string                 `json:"content"`
	CreatedAt     string                 `json:"created_at"`
	UpdatedAt     string                 `json:"updated_at"`
	User          dto.PublicUserResponse `json:"user"`
	LikesCount    int64                  `json:"likes_count"`
	CommentsCount int64                  `json:"comments_count"`
	IsLiked       bool                   `json:"is_liked"`
}

type CommentResponse struct {
	ID         uint                   `json:"id"`
	Content    string                 `json:"content"`
	CreatedAt  string                 `json:"created_at"`
	UpdatedAt  string                 `json:"updated_at"`
	User       dto.PublicUserResponse `json:"user"`
	PostID     uint                   `json:"post_id"`
	LikesCount int64                  `json:"likes_count"`
	IsLiked    bool                   `json:"is_liked"`
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
		User:          dto.ToPublicUserResponse(post.User),
		LikesCount:    likesCount,
		CommentsCount: commentsCount,
		IsLiked:       isLiked,
	}
}

func buildPostResponses(db *gorm.DB, posts []models.Post, currentUserID uint) []PostResponse {
	if len(posts) == 0 {
		return []PostResponse{}
	}

	postIDs := make([]uint, 0, len(posts))
	for _, post := range posts {
		postIDs = append(postIDs, post.ID)
	}
	likesByPost := countPostLikes(db, postIDs)
	commentsByPost := countPostComments(db, postIDs)
	likedPosts := likedPostIDs(db, postIDs, currentUserID)

	response := make([]PostResponse, 0, len(posts))
	for _, post := range posts {
		response = append(response, PostResponse{
			ID:            post.ID,
			Content:       post.Content,
			CreatedAt:     post.CreatedAt.Format("2006-01-02 15:04:05"),
			UpdatedAt:     post.UpdatedAt.Format("2006-01-02 15:04:05"),
			User:          dto.ToPublicUserResponse(post.User),
			LikesCount:    likesByPost[post.ID],
			CommentsCount: commentsByPost[post.ID],
			IsLiked:       likedPosts[post.ID],
		})
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
		User:       dto.ToPublicUserResponse(comment.User),
		PostID:     comment.PostID,
		LikesCount: likesCount,
		IsLiked:    isLiked,
	}
}

func buildCommentResponses(db *gorm.DB, comments []models.Comment, currentUserID uint) []CommentResponse {
	if len(comments) == 0 {
		return []CommentResponse{}
	}

	commentIDs := make([]uint, 0, len(comments))
	for _, comment := range comments {
		commentIDs = append(commentIDs, comment.ID)
	}
	likesByComment := countCommentLikes(db, commentIDs)
	likedComments := likedCommentIDs(db, commentIDs, currentUserID)

	response := make([]CommentResponse, 0, len(comments))
	for _, comment := range comments {
		response = append(response, CommentResponse{
			ID:         comment.ID,
			Content:    comment.Content,
			CreatedAt:  comment.CreatedAt.Format("2006-01-02 15:04:05"),
			User:       dto.ToPublicUserResponse(comment.User),
			PostID:     comment.PostID,
			LikesCount: likesByComment[comment.ID],
			IsLiked:    likedComments[comment.ID],
		})
	}

	return response
}

type countRow struct {
	ID    uint
	Count int64
}

func countPostLikes(db *gorm.DB, postIDs []uint) map[uint]int64 {
	var rows []countRow
	db.Model(&models.PostLike{}).
		Select("post_id AS id, COUNT(*) AS count").
		Where("post_id IN ?", postIDs).
		Group("post_id").
		Scan(&rows)
	return countRowsToMap(rows)
}

func countPostComments(db *gorm.DB, postIDs []uint) map[uint]int64 {
	var rows []countRow
	db.Model(&models.Comment{}).
		Select("post_id AS id, COUNT(*) AS count").
		Where("post_id IN ?", postIDs).
		Group("post_id").
		Scan(&rows)
	return countRowsToMap(rows)
}

func countCommentLikes(db *gorm.DB, commentIDs []uint) map[uint]int64 {
	var rows []countRow
	db.Model(&models.CommentLike{}).
		Select("comment_id AS id, COUNT(*) AS count").
		Where("comment_id IN ?", commentIDs).
		Group("comment_id").
		Scan(&rows)
	return countRowsToMap(rows)
}

func countRowsToMap(rows []countRow) map[uint]int64 {
	counts := make(map[uint]int64, len(rows))
	for _, row := range rows {
		counts[row.ID] = row.Count
	}
	return counts
}

func likedPostIDs(db *gorm.DB, postIDs []uint, userID uint) map[uint]bool {
	var ids []uint
	db.Model(&models.PostLike{}).
		Where("post_id IN ? AND user_id = ?", postIDs, userID).
		Pluck("post_id", &ids)
	return idsToSet(ids)
}

func likedCommentIDs(db *gorm.DB, commentIDs []uint, userID uint) map[uint]bool {
	var ids []uint
	db.Model(&models.CommentLike{}).
		Where("comment_id IN ? AND user_id = ?", commentIDs, userID).
		Pluck("comment_id", &ids)
	return idsToSet(ids)
}

func idsToSet(ids []uint) map[uint]bool {
	set := make(map[uint]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set
}
