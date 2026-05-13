package repository

import (
	"errors"
	"tester/internal/models"

	"gorm.io/gorm"
)

func SendFriendRequest(db *gorm.DB, userID, friendID uint) error {
	friendship := models.Friendship{
		UserID:   userID,
		FriendID: friendID,
		Status:   "pending",
	}
	return db.Create(&friendship).Error
}

func GetFriendshipStatus(db *gorm.DB, userID, friendID uint) (string, error) {
	var friendship models.Friendship
	err := db.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).Select("status").First(&friendship).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "none", nil
		}
		return "", err
	}
	return friendship.Status, nil
}

func GetFriendsList(db *gorm.DB, userID uint) ([]models.User, error) {
	var friends []models.User
	err := db.Table("users").
		Select("users.*").
		Joins("JOIN friendships ON (friendships.user_id = users.id AND friendships.friend_id = ?) OR (friendships.friend_id = users.id AND friendships.user_id = ?)", userID, userID).
		Where("friendships.status = ?", "accepted").
		Find(&friends).Error
	return friends, err
}

func GetFriendRequests(db *gorm.DB, userID uint) ([]models.Friendship, error) {
	var requests []models.Friendship
	err := db.Preload("User").
		Where("friend_id = ? AND status = ?", userID, "pending").
		Find(&requests).Error
	return requests, err
}

func AcceptFriendRequest(db *gorm.DB, friendshipID, userID uint) error {
	return db.Model(&models.Friendship{}).
		Where("id = ? AND friend_id = ? AND status = ?", friendshipID, userID, "pending").
		Update("status", "accepted").Error
}

func RemoveFriend(db *gorm.DB, userID, friendID uint) error {
	return db.Where(
		"(user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
		userID, friendID, friendID, userID,
	).Delete(&models.Friendship{}).Error
}

func BlockUser(db *gorm.DB, userID, friendID uint) error {
	RemoveFriend(db, userID, friendID)

	friendship := models.Friendship{
		UserID:   userID,
		FriendID: friendID,
		Status:   "blocked",
	}
	return db.Create(&friendship).Error
}
