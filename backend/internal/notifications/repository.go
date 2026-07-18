package notifications

import (
	"context"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type repository struct {
	db *gorm.DB
}

type notificationCursor struct {
	CreatedAt time.Time
	ID        uint
}

func newRepository(db *gorm.DB) *repository {
	return &repository{db: db}
}

func (r *repository) createOnce(ctx context.Context, notification *models.Notification) (bool, error) {
	result := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "dedupe_key"}},
		DoNothing: true,
	}).Create(notification)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func (r *repository) findByDedupeKey(ctx context.Context, dedupeKey string) (models.Notification, error) {
	var notification models.Notification
	err := r.db.WithContext(ctx).Where("dedupe_key = ?", dedupeKey).First(&notification).Error
	return notification, err
}

func (r *repository) findPageByRecipientID(
	ctx context.Context,
	userID uint,
	limit int,
	cursor *notificationCursor,
) ([]models.Notification, bool, error) {
	query := r.db.WithContext(ctx).Where("recipient_id = ?", userID)
	if cursor != nil {
		query = query.Where(
			"created_at < ? OR (created_at = ? AND id < ?)",
			cursor.CreatedAt,
			cursor.CreatedAt,
			cursor.ID,
		)
	}
	var notifications []models.Notification
	if err := query.Order("created_at DESC, id DESC").Limit(limit + 1).Find(&notifications).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(notifications) > limit
	if hasMore {
		notifications = notifications[:limit]
	}
	return notifications, hasMore, nil
}

func (r *repository) countUnseen(ctx context.Context, userID uint) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.Notification{}).
		Where("recipient_id = ? AND is_seen = ?", userID, false).
		Count(&count).Error
	return count, err
}

func (r *repository) markAsRead(ctx context.Context, id uint, userID uint) error {
	return r.db.WithContext(ctx).Model(&models.Notification{}).
		Where("id = ? AND recipient_id = ?", id, userID).
		Updates(map[string]interface{}{
			"is_read": true,
			"is_seen": true,
		}).Error
}

func (r *repository) markAsSeen(ctx context.Context, userID uint, ids []uint) error {
	if len(ids) == 0 {
		return nil
	}

	return r.db.WithContext(ctx).Model(&models.Notification{}).
		Where("recipient_id = ? AND id IN ?", userID, ids).
		Update("is_seen", true).Error
}

func (r *repository) markMatchingAsRead(
	ctx context.Context,
	userID uint,
	types []string,
	actorID *uint,
	entityID *uint,
	conversationID *uint,
) error {
	query := r.db.WithContext(ctx).Model(&models.Notification{}).
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

func (r *repository) markMessageConversationRead(ctx context.Context, userID uint, conversationID uint) error {
	return r.db.WithContext(ctx).Model(&models.Notification{}).
		Where(
			`recipient_id = ? AND (is_read = false OR is_seen = false)
				AND type = ? AND (conversation_id = ? OR actor_id = ?)`,
			userID,
			TypeMessage,
			conversationID,
			conversationID,
		).
		Updates(map[string]interface{}{
			"is_read": true,
			"is_seen": true,
		}).Error
}

func (r *repository) isNotificationRead(ctx context.Context, id uint) (bool, error) {
	var notification models.Notification
	err := r.db.WithContext(ctx).Select("is_read").First(&notification, id).Error
	return notification.IsRead, err
}

func (r *repository) upsertMobilePushToken(ctx context.Context, token *models.MobilePushToken) error {
	now := time.Now()
	token.LastSeenAt = now

	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
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

func (r *repository) findMobilePushTokensByUserID(ctx context.Context, userID uint) ([]models.MobilePushToken, error) {
	var tokens []models.MobilePushToken
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Find(&tokens).Error
	return tokens, err
}

func (r *repository) revokeMobilePushToken(
	ctx context.Context,
	userID uint,
	provider string,
	token string,
) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.MobilePushToken{}).
		Where("user_id = ? AND provider = ? AND token = ?", userID, provider, token).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

func (r *repository) revokeMobilePushTokenByID(ctx context.Context, id uint) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.MobilePushToken{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"revoked_at": now,
			"updated_at": now,
		}).Error
}

func (r *repository) findMessageByID(ctx context.Context, id uint) (models.Message, error) {
	var message models.Message
	err := r.db.WithContext(ctx).Preload("Attachments").First(&message, id).Error
	return message, err
}

func (r *repository) findUserByID(ctx context.Context, id uint) (models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).First(&user, id).Error
	return user, err
}
