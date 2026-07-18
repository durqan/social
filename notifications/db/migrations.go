package db

import (
	"fmt"
	"notifications/models"
	"os"
	"time"

	"gorm.io/gorm"
)

const notificationSeenRepairBeforeEnv = "NOTIFICATIONS_IS_SEEN_REPAIR_BEFORE"

const (
	notificationDedupeMigrationVersion = "20260714_notification_push_dedupe_v1"
	notificationSeenMigrationVersion   = "20260714_notification_seen_schema_v1"
	notificationRepairMigrationVersion = "20260714_notification_seen_repair_v1"
	dropWebPushMigrationVersion        = "20260718_drop_web_push_v1"
	notificationMigrationLockID        = int64(2026071402)
)

type schemaMigration struct {
	Version   string    `gorm:"primaryKey;type:varchar(128)"`
	AppliedAt time.Time `gorm:"not null"`
}

func (schemaMigration) TableName() string { return "notification_schema_migrations" }

func Migrate(database *gorm.DB) error {
	if err := database.AutoMigrate(&schemaMigration{}); err != nil {
		return err
	}
	if err := runVersionedMigration(database, notificationDedupeMigrationVersion, func(tx *gorm.DB) error {
		return dedupeMobilePushTokens(tx)
	}); err != nil {
		return err
	}

	if err := runVersionedMigration(database, notificationSeenMigrationVersion, migrateNotificationSeen); err != nil {
		return err
	}

	if err := database.AutoMigrate(
		&models.Notification{},
		&models.MobilePushToken{},
	); err != nil {
		return err
	}
	if err := runVersionedMigration(database, dropWebPushMigrationVersion, dropWebPushSubscriptions); err != nil {
		return err
	}

	if err := runVersionedMigration(database, notificationRepairMigrationVersion, repairNotificationSeen); err != nil {
		return err
	}

	return ensurePerformanceIndexes(database)
}

func runVersionedMigration(database *gorm.DB, version string, migration func(*gorm.DB) error) error {
	return database.Transaction(func(tx *gorm.DB) error {
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", notificationMigrationLockID).Error; err != nil {
				return err
			}
		}
		var count int64
		if err := tx.Model(&schemaMigration{}).Where("version = ?", version).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		if err := migration(tx); err != nil {
			return err
		}
		return tx.Create(&schemaMigration{Version: version, AppliedAt: time.Now()}).Error
	})
}

func migrateNotificationSeen(database *gorm.DB) error {
	if !database.Migrator().HasTable(&models.Notification{}) {
		return nil
	}
	hasSeenColumn := database.Migrator().HasColumn(&models.Notification{}, "is_seen")

	if database.Dialector.Name() == "postgres" {
		if !hasSeenColumn {
			if err := database.Exec("ALTER TABLE notifications ADD COLUMN is_seen boolean").Error; err != nil {
				return err
			}
		}
		if err := database.Exec("UPDATE notifications SET is_seen = true WHERE is_seen IS NULL").Error; err != nil {
			return err
		}
		if err := database.Exec("ALTER TABLE notifications ALTER COLUMN is_seen SET DEFAULT false").Error; err != nil {
			return err
		}
		return database.Exec("ALTER TABLE notifications ALTER COLUMN is_seen SET NOT NULL").Error
	}

	if !hasSeenColumn {
		if err := database.Exec("ALTER TABLE notifications ADD COLUMN is_seen boolean").Error; err != nil {
			return err
		}
	}
	return database.Exec("UPDATE notifications SET is_seen = true WHERE is_seen IS NULL").Error
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
		"idx_notifications_recipient_created_id ON notifications (recipient_id, created_at DESC, id DESC)",
		"idx_notifications_recipient_actor_type_unread ON notifications (recipient_id, actor_id, type) WHERE is_read = false OR is_seen = false",
		"idx_notifications_recipient_type_entity_unread ON notifications (recipient_id, type, entity_id) WHERE is_read = false OR is_seen = false",
		"idx_notifications_recipient_conversation_type_unread ON notifications (recipient_id, conversation_id, type) WHERE is_read = false OR is_seen = false",
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

func dedupeMobilePushTokens(database *gorm.DB) error {
	return deleteOlderDuplicates(database, &models.MobilePushToken{}, "token")
}

func dropWebPushSubscriptions(database *gorm.DB) error {
	if !database.Migrator().HasTable("push_subscriptions") {
		return nil
	}
	return database.Migrator().DropTable("push_subscriptions")
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
