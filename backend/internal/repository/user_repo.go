package repository

import (
	"errors"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

type UserDeletionArtifacts struct {
	UploadPaths []string
}

func CreateUser(db *gorm.DB, user *models.User) error {
	result := db.Create(user)
	return result.Error
}

func GetAllUsers(db *gorm.DB) ([]models.User, error) {
	var users []models.User
	result := db.Find(&users)
	return users, result.Error
}

func GetUserById(db *gorm.DB, userId uint) (models.User, error) {
	var user models.User
	result := db.First(&user, userId)
	return user, result.Error
}

func GetUserByEmail(db *gorm.DB, email string) (models.User, error) {
	var user models.User
	result := db.Where("email = ?", email).First(&user)
	return user, result.Error
}

func UpdateUser(db *gorm.DB, userId uint, updates map[string]interface{}) error {
	if userId <= 0 {
		return gorm.ErrRecordNotFound
	}

	result := db.Model(&models.User{}).
		Where("id = ?", userId).
		Updates(updates)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteUser(db *gorm.DB, userId uint) (UserDeletionArtifacts, error) {
	var artifacts UserDeletionArtifacts

	if userId <= 0 {
		return artifacts, gorm.ErrRecordNotFound
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		user, err := getUserForDeletion(tx, userId)
		if err != nil {
			return err
		}

		artifacts.UploadPaths = appendLocalUploadPath(artifacts.UploadPaths, user.Avatar)

		if err := deleteUserAssociations(tx, userId, &artifacts); err != nil {
			return err
		}

		result := tx.Delete(&models.User{}, userId)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})

	return artifacts, err
}

func DeleteExpiredUnverifiedUser(db *gorm.DB, userId uint, cutoff time.Time) (UserDeletionArtifacts, bool, error) {
	var artifacts UserDeletionArtifacts

	if userId <= 0 {
		return artifacts, false, gorm.ErrRecordNotFound
	}

	err := db.Transaction(func(tx *gorm.DB) error {
		user, err := getExpiredUnverifiedUserForDeletion(tx, userId, cutoff)
		if err != nil {
			return err
		}

		artifacts.UploadPaths = appendLocalUploadPath(artifacts.UploadPaths, user.Avatar)

		if err := deleteUserAssociations(tx, userId, &artifacts); err != nil {
			return err
		}

		result := tx.Where("id = ? AND is_email_verified = ? AND created_at <= ?", userId, false, cutoff).
			Delete(&models.User{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return artifacts, false, nil
	}
	if err != nil {
		return artifacts, false, err
	}

	return artifacts, true, nil
}

func GetExpiredUnverifiedUserIDs(db *gorm.DB, cutoff time.Time) ([]uint, error) {
	var userIDs []uint
	err := db.Model(&models.User{}).
		Where("is_email_verified = ? AND created_at <= ?", false, cutoff).
		Order("created_at ASC").
		Pluck("id", &userIDs).Error

	return userIDs, err
}

func getUserForDeletion(db *gorm.DB, userID uint) (models.User, error) {
	var user models.User
	err := db.First(&user, userID).Error
	return user, err
}

func getExpiredUnverifiedUserForDeletion(db *gorm.DB, userID uint, cutoff time.Time) (models.User, error) {
	var user models.User
	err := db.Where("id = ? AND is_email_verified = ? AND created_at <= ?", userID, false, cutoff).
		First(&user).Error
	return user, err
}

func deleteUserAssociations(tx *gorm.DB, userID uint, artifacts *UserDeletionArtifacts) error {
	postIDs, err := userPostIDs(tx, userID)
	if err != nil {
		return err
	}

	commentIDs, err := userRelatedCommentIDs(tx, userID, postIDs)
	if err != nil {
		return err
	}

	messageIDs, err := userMessageIDs(tx, userID)
	if err != nil {
		return err
	}

	if err := collectMessageAttachmentPaths(tx, messageIDs, artifacts); err != nil {
		return err
	}

	if err := deleteCommentLikes(tx, userID, commentIDs); err != nil {
		return err
	}
	if err := deleteComments(tx, commentIDs); err != nil {
		return err
	}
	if err := deletePostLikes(tx, userID, postIDs); err != nil {
		return err
	}
	if err := deletePosts(tx, postIDs); err != nil {
		return err
	}
	if err := deleteMessageAttachments(tx, messageIDs); err != nil {
		return err
	}
	if err := deleteMessages(tx, userID); err != nil {
		return err
	}
	if err := deleteFriendships(tx, userID); err != nil {
		return err
	}
	if err := deleteEmailVerifications(tx, userID); err != nil {
		return err
	}
	if err := deleteNotificationRows(tx, userID); err != nil {
		return err
	}

	return nil
}

func userPostIDs(tx *gorm.DB, userID uint) ([]uint, error) {
	var postIDs []uint
	err := tx.Model(&models.Post{}).
		Where("user_id = ?", userID).
		Pluck("id", &postIDs).Error
	return postIDs, err
}

func userRelatedCommentIDs(tx *gorm.DB, userID uint, postIDs []uint) ([]uint, error) {
	var commentIDs []uint

	query := tx.Model(&models.Comment{}).Where("user_id = ?", userID)
	if len(postIDs) > 0 {
		query = query.Or("post_id IN ?", postIDs)
	}

	err := query.Pluck("id", &commentIDs).Error
	return commentIDs, err
}

func userMessageIDs(tx *gorm.DB, userID uint) ([]uint, error) {
	var messageIDs []uint
	err := tx.Model(&models.Message{}).
		Where("from_id = ? OR to_id = ?", userID, userID).
		Pluck("id", &messageIDs).Error
	return messageIDs, err
}

func collectMessageAttachmentPaths(tx *gorm.DB, messageIDs []uint, artifacts *UserDeletionArtifacts) error {
	if len(messageIDs) == 0 {
		return nil
	}

	var paths []string
	if err := tx.Model(&models.MessageAttachment{}).
		Where("message_id IN ?", messageIDs).
		Pluck("file_url", &paths).Error; err != nil {
		return err
	}

	for _, path := range paths {
		artifacts.UploadPaths = appendLocalUploadPath(artifacts.UploadPaths, path)
	}
	return nil
}

func deleteCommentLikes(tx *gorm.DB, userID uint, commentIDs []uint) error {
	if err := tx.Where("user_id = ?", userID).Delete(&models.CommentLike{}).Error; err != nil {
		return err
	}
	if len(commentIDs) == 0 {
		return nil
	}
	return tx.Where("comment_id IN ?", commentIDs).Delete(&models.CommentLike{}).Error
}

func deleteComments(tx *gorm.DB, commentIDs []uint) error {
	if len(commentIDs) == 0 {
		return nil
	}
	return tx.Where("id IN ?", commentIDs).Delete(&models.Comment{}).Error
}

func deletePostLikes(tx *gorm.DB, userID uint, postIDs []uint) error {
	if err := tx.Where("user_id = ?", userID).Delete(&models.PostLike{}).Error; err != nil {
		return err
	}
	if len(postIDs) == 0 {
		return nil
	}
	return tx.Where("post_id IN ?", postIDs).Delete(&models.PostLike{}).Error
}

func deletePosts(tx *gorm.DB, postIDs []uint) error {
	if len(postIDs) == 0 {
		return nil
	}
	return tx.Where("id IN ?", postIDs).Delete(&models.Post{}).Error
}

func deleteMessageAttachments(tx *gorm.DB, messageIDs []uint) error {
	if len(messageIDs) == 0 {
		return nil
	}
	return tx.Where("message_id IN ?", messageIDs).Delete(&models.MessageAttachment{}).Error
}

func deleteMessages(tx *gorm.DB, userID uint) error {
	return tx.Where("from_id = ? OR to_id = ?", userID, userID).Delete(&models.Message{}).Error
}

func deleteFriendships(tx *gorm.DB, userID uint) error {
	return tx.Where("user_id = ? OR friend_id = ?", userID, userID).Delete(&models.Friendship{}).Error
}

func deleteEmailVerifications(tx *gorm.DB, userID uint) error {
	return tx.Where("user_id = ?", userID).Delete(&models.EmailVerification{}).Error
}

func deleteNotificationRows(tx *gorm.DB, userID uint) error {
	if tx.Migrator().HasTable("notifications") {
		if err := tx.Exec("DELETE FROM notifications WHERE recipient_id = ? OR actor_id = ?", userID, userID).Error; err != nil {
			return err
		}
	}

	if tx.Migrator().HasTable("push_subscriptions") {
		if err := tx.Exec("DELETE FROM push_subscriptions WHERE user_id = ?", userID).Error; err != nil {
			return err
		}
	}

	return nil
}

func appendLocalUploadPath(paths []string, path string) []string {
	if path == "" {
		return paths
	}
	return append(paths, path)
}

func ChangePassword(db *gorm.DB, userId uint, hashedPassword string) error {
	if userId <= 0 {
		return gorm.ErrRecordNotFound
	}

	result := db.Model(&models.User{}).
		Where("id = ?", userId).
		Update("password", hashedPassword)

	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func GetUsersByEmailOrName(db *gorm.DB, query string) ([]models.User, error) {
	var users []models.User
	err := db.Where("name LIKE ? OR email LIKE ?",
		"%"+query+"%",
		"%"+query+"%").
		Limit(20).
		Find(&users).Error
	return users, err
}

func UpdateUserAvatar(db *gorm.DB, userID uint, avatar string) error {
	if userID <= 0 {
		return gorm.ErrRecordNotFound
	}

	result := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("avatar", avatar)

	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}
