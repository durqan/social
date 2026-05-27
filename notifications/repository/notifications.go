package repository

import (
	"notifications/models"

	"gorm.io/gorm"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(notification *models.Notification) error {
	return r.db.Create(&notification).Error
}

func (r *Repository) FindByRecipientID(userID uint) ([]models.Notification, error) {
	var notifications []models.Notification

	err := r.db.
		Where("recipient_id = ?", userID).
		Order("created_at desc").
		Find(&notifications).Error

	if err != nil {
		return nil, err
	}

	return notifications, nil
}

func (r *Repository) MarkAsRead(id uint) error {
	return r.db.Model(&models.Notification{}).
		Where("id = ?", id).
		Update("is_read", true).Error
}
