package models

type CommentLike struct {
	ID        uint `json:"id" gorm:"primarykey"`
	CommentID uint `json:"comment_id" gorm:"not null;uniqueIndex:idx_comment_user"`
	UserID    uint `json:"user_id" gorm:"not null;uniqueIndex:idx_comment_user"`
}
