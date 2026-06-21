package db

import (
	"fmt"
	"notifications/models"
	"os"
	"time"

	"gorm.io/gorm"
)

const notificationSeenRepairBeforeEnv = "NOTIFICATIONS_IS_SEEN_REPAIR_BEFORE"

func Migrate(database *gorm.DB) error {
	if err := dedupePushSubscriptions(database); err != nil {
		return err
	}
	if err := dedupeMobilePushTokens(database); err != nil {
		return err
	}

	if err := migrateNotificationSeen(database); err != nil {
		return err
	}

	if err := database.AutoMigrate(
		&models.Notification{},
		&models.PushSubscription{},
		&models.MobilePushToken{},
	); err != nil {
		return err
	}

	if err := repairNotificationSeen(database); err != nil {
		return err
	}

	return ensurePerformanceIndexes(database)
}

func migrateNotificationSeen(database *gorm.DB) error {
	if !database.Migrator().HasTable(&models.Notification{}) ||
		database.Migrator().HasColumn(&models.Notification{}, "is_seen") {
		return nil
	}

	if database.Dialector.Name() == "postgres" {
		if err := database.Exec("ALTER TABLE notifications ADD COLUMN is_seen boolean").Error; err != nil {
			return err
		}
		if err := database.Exec("UPDATE notifications SET is_seen = true WHERE is_seen IS NULL").Error; err != nil {
			return err
		}
		if err := database.Exec("ALTER TABLE notifications ALTER COLUMN is_seen SET DEFAULT false").Error; err != nil {
			return err
		}
		return database.Exec("ALTER TABLE notifications ALTER COLUMN is_seen SET NOT NULL").Error
	}

	if err := database.Exec("ALTER TABLE notifications ADD COLUMN is_seen boolean DEFAULT false").Error; err != nil {
		return err
	}
	return database.Exec("UPDATE notifications SET is_seen = true").Error
}

func repairNotificationSeen(database *gorm.DB) error {
	if !database.Migrator().HasTable(&models.Notification{}) ||
		!database.Migrator().HasColumn(&models.Notification{}, "is_seen") {
		return nil
	}

	if err := database.Model(&models.Notification{}).
		Where("is_read = ? AND is_seen = ?", true, false).
		Update("is_seen", true).Error; err != nil {
		return err
	}

	cutoffValue := os.Getenv(notificationSeenRepairBeforeEnv)
	if cutoffValue == "" {
		return nil
	}
	cutoff, err := time.Parse(time.RFC3339, cutoffValue)
	if err != nil {
		return fmt.Errorf("parse %s: %w", notificationSeenRepairBeforeEnv, err)
	}

	query := database.Model(&models.Notification{}).Where("is_seen = ?", false)
	if database.Dialector.Name() == "sqlite" {
		query = query.Where("datetime(created_at) < datetime(?)", cutoff.Format(time.RFC3339))
	} else {
		query = query.Where("created_at < ?", cutoff)
	}

	return query.Update("is_seen", true).Error
}

func ensurePerformanceIndexes(database *gorm.DB) error {
	indexes := []string{
		"idx_notifications_recipient_conversation_type ON notifications (recipient_id, conversation_id, type)",
	}
	for _, index := range indexes {
		if err := createIndexIfMissing(database, index); err != nil {
			return err
		}
	}
	return nil
}

func createIndexIfMissing(database *gorm.DB, definition string) error {
	concurrently := ""
	if database.Dialector.Name() == "postgres" {
		concurrently = "CONCURRENTLY "
	}
	return database.Exec("CREATE INDEX " + concurrently + "IF NOT EXISTS " + definition).Error
}

func dedupePushSubscriptions(database *gorm.DB) error {
	return deleteOlderDuplicates(database, &models.PushSubscription{}, "endpoint")
}

func dedupeMobilePushTokens(database *gorm.DB) error {
	return deleteOlderDuplicates(database, &models.MobilePushToken{}, "token")
}

func deleteOlderDuplicates(database *gorm.DB, model any, column string) error {
	if !database.Migrator().HasTable(model) {
		return nil
	}

	var duplicateIDs []uint
	statement := &gorm.Statement{DB: database}
	if err := statement.Parse(model); err != nil {
		return err
	}
	table := statement.Schema.Table
	query := fmt.Sprintf(`
		SELECT older.id
		FROM %s AS older
		JOIN %s AS newer
		  ON older.%s = newer.%s
		 AND older.id < newer.id
	`, table, table, column, column)
	if err := database.Raw(query).Scan(&duplicateIDs).Error; err != nil {
		return err
	}
	if len(duplicateIDs) == 0 {
		return nil
	}

	return database.Exec("DELETE FROM "+table+" WHERE id IN ?", duplicateIDs).Error
}
