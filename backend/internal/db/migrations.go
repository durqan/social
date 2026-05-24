package db

import (
	"tester/internal/models"

	"gorm.io/gorm"
)

func Migrate(database *gorm.DB) error {
	return database.AutoMigrate(
		&models.User{},
		&models.Post{},
		&models.PostLike{},
		&models.CommentLike{},
		&models.Comment{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.Friendship{},
		&models.EmailVerification{},
	)
}
