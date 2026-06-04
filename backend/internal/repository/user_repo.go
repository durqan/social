package repository

import (
	"tester/internal/models"

	"gorm.io/gorm"
)

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
	err := db.Where("name ILIKE ? OR email ILIKE ?",
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
		Updates(map[string]interface{}{
			"avatar":            avatar,
			"avatar_position_x": 50,
			"avatar_position_y": 50,
			"avatar_scale":      1,
		})

	if result.Error != nil {
		return result.Error
	}

	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}

	return nil
}
