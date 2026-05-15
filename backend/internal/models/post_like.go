package models

type PostLike struct {
	ID     uint `json:"id" gorm:"primarykey"`
	PostID uint `json:"post_id" gorm:"not null;uniqueIndex:idx_post_user"`
	UserID uint `json:"user_id" gorm:"not null;uniqueIndex:idx_post_user"`
}
