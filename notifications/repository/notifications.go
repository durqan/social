package repository

import (
	"notifications/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Create(notification *models.Notification) error {
	return r.db.Create(notification).Error
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

func (r *Repository) MarkAsRead(id uint, userID uint) error {
	return r.db.Model(&models.Notification{}).
		Where("id = ? AND recipient_id = ?", id, userID).
		Update("is_read", true).Error
}

func (r *Repository) UpsertPushSubscription(subscription *models.PushSubscription) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.AssignmentColumns([]string{"user_id", "p256dh", "auth"}),
	}).Create(subscription).Error
}

func (r *Repository) FindPushSubscriptionsByUserID(userID uint) ([]models.PushSubscription, error) {
	var subscriptions []models.PushSubscription

	err := r.db.
		Where("user_id = ?", userID).
		Find(&subscriptions).Error
	if err != nil {
		return nil, err
	}

	return subscriptions, nil
}

func (r *Repository) DeletePushSubscription(id uint) error {
	return r.db.Delete(&models.PushSubscription{}, id).Error
}
