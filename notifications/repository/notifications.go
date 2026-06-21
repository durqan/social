package repository

import (
	"time"

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

func (r *Repository) CreateOnce(notification *models.Notification) (bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedupe_key"}},
		DoNothing: true,
	}).Create(notification)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
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
		Updates(map[string]interface{}{
			"is_read": true,
			"is_seen": true,
		}).Error
}

func (r *Repository) MarkAsSeen(userID uint, ids []uint) error {
	if len(ids) == 0 {
		return nil
	}

	return r.db.Model(&models.Notification{}).
		Where("recipient_id = ? AND id IN ?", userID, ids).
		Update("is_seen", true).Error
}

func (r *Repository) MarkMatchingAsRead(userID uint, types []string, actorID *uint, entityID *uint, conversationID *uint) error {
	query := r.db.Model(&models.Notification{}).
		Where("recipient_id = ? AND (is_read = false OR is_seen = false)", userID)

	if len(types) > 0 {
		query = query.Where("type IN ?", types)
	}
	if actorID != nil {
		query = query.Where("actor_id = ?", *actorID)
	}
	if entityID != nil {
		query = query.Where("entity_id = ?", *entityID)
	}
	if conversationID != nil {
		query = query.Where("(conversation_id = ? OR actor_id = ?)", *conversationID, *conversationID)
	}

	return query.Updates(map[string]interface{}{
		"is_read": true,
		"is_seen": true,
	}).Error
}

func (r *Repository) MarkMessageConversationRead(userID uint, conversationID uint) error {
	return r.db.Model(&models.Notification{}).
		Where("recipient_id = ? AND (is_read = false OR is_seen = false) AND type = ? AND (conversation_id = ? OR actor_id = ?)",
			userID,
			"message_received",
			conversationID,
			conversationID,
		).
		Updates(map[string]interface{}{
			"is_read": true,
			"is_seen": true,
		}).Error
}

func (r *Repository) IsNotificationRead(id uint) (bool, error) {
	var notification models.Notification
	err := r.db.Select("is_read").First(&notification, id).Error
	if err != nil {
		return false, err
	}
	return notification.IsRead, nil
}

func (r *Repository) UpsertPushSubscription(subscription *models.PushSubscription) error {
	now := time.Now()
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "endpoint"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"user_id":    subscription.UserID,
			"p256dh":     subscription.P256DH,
			"auth":       subscription.Auth,
			"updated_at": now,
		}),
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

func (r *Repository) DeletePushSubscriptionForUser(userID uint, endpoint string) error {
	return r.db.
		Where("user_id = ? AND endpoint = ?", userID, endpoint).
		Delete(&models.PushSubscription{}).Error
}

func (r *Repository) UpsertMobilePushToken(token *models.MobilePushToken) error {
	now := time.Now()
	token.LastSeenAt = now

	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "token"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"user_id":      token.UserID,
			"provider":     token.Provider,
			"platform":     token.Platform,
			"revoked_at":   nil,
			"last_seen_at": now,
			"updated_at":   now,
		}),
	}).Create(token).Error
}

func (r *Repository) FindMobilePushTokensByUserID(userID uint) ([]models.MobilePushToken, error) {
	var tokens []models.MobilePushToken

	err := r.db.
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Find(&tokens).Error
	if err != nil {
		return nil, err
	}

	return tokens, nil
}

func (r *Repository) RevokeMobilePushToken(userID uint, provider string, token string) error {
	now := time.Now()
	return r.db.Model(&models.MobilePushToken{}).
		Where("user_id = ? AND provider = ? AND token = ?", userID, provider, token).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

func (r *Repository) RevokeMobilePushTokenByID(id uint) error {
	now := time.Now()
	return r.db.Model(&models.MobilePushToken{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

func (r *Repository) FindMessageByID(id uint) (models.Message, error) {
	var message models.Message
	err := r.db.
		Preload("Attachments").
		First(&message, id).Error
	return message, err
}

func (r *Repository) FindUserByID(id uint) (models.User, error) {
	var user models.User
	err := r.db.First(&user, id).Error
	return user, err
}
