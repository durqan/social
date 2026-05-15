package repository

import (
	"tester/internal/models"

	"gorm.io/gorm"
)

func CreatePost(db *gorm.DB, post *models.Post) error {
	return db.Create(post).Error
}

func GetAllPosts(db *gorm.DB) ([]models.Post, error) {
	var posts []models.Post
	err := db.Preload("User").Order("created_at DESC").Find(&posts).Error
	return posts, err
}

func GetPostsByUser(db *gorm.DB, userID uint) ([]models.Post, error) {
	var posts []models.Post
	err := db.Preload("User").
		Where("UserID = ?", userID).
		Order("created_at DESC").
		Find(&posts).Error

	return posts, err
}

func GetPostByID(db *gorm.DB, postID uint) (models.Post, error) {
	var post models.Post
	err := db.Preload("User").First(&post, postID).Error
	return post, err
}

func UpdatePost(db *gorm.DB, postID uint, content string) error {
	result := db.Model(&models.Post{}).
		Where("id = ?", postID).
		Update("content", content)
	return result.Error
}

func DeletePost(db *gorm.DB, postID uint) error {
	result := db.Delete(&models.Post{}, postID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func GetPostLikeCount(db *gorm.DB, postID uint) (int64, error) {
	var count int64
	err := db.Model(&models.Like{}).Where("post_id = ?", postID).Count(&count).Error
	return count, err
}

func GetPostCommentCount(db *gorm.DB, postID uint) (int64, error) {
	var count int64
	err := db.Model(&models.Comment{}).Where("post_id = ?", postID).Count(&count).Error
	return count, err
}

func IsPostLikedByUser(db *gorm.DB, postID, userID uint) (bool, error) {
	var like models.Like
	err := db.Where("post_id = ? AND user_id = ?", postID, userID).First(&like).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func ToggleLike(db *gorm.DB, postID, userID uint) (bool, error) {
	var like models.Like
	err := db.Where("post_id = ? AND user_id = ?", postID, userID).First(&like).Error

	if err == gorm.ErrRecordNotFound {
		like = models.Like{PostID: postID, UserID: userID}
		err = db.Create(&like).Error
		return true, err
	}
	if err != nil {
		return false, err
	}

	err = db.Delete(&like).Error
	return false, err
}

func GetCommentsByPostID(db *gorm.DB, postID uint) ([]models.Comment, error) {
	var comments []models.Comment
	err := db.Preload("User").
		Where("post_id = ?", postID).
		Order("created_at ASC").
		Find(&comments).Error
	return comments, err
}

func CreateComment(db *gorm.DB, comment *models.Comment) error {
	return db.Create(comment).Error
}

func DeletePostComments(db *gorm.DB, postID uint) error {
	return db.Where("post_id = ?", postID).Delete(&models.Comment{}).Error
}

func DeletePostLikes(db *gorm.DB, postID uint) error {
	return db.Where("post_id = ?", postID).Delete(&models.Like{}).Error
}

func IsPostOwner(db *gorm.DB, postID, userID uint) bool {
	var post models.Post
	err := db.First(&post, postID).Error
	if err != nil {
		return false
	}
	return post.UserID == userID
}
