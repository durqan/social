package db

import (
	"fmt"
	"notifications/models"

	"gorm.io/gorm"
)

func Migrate(database *gorm.DB) error {
	if err := dedupePushSubscriptions(database); err != nil {
		return err
	}
	if err := dedupeMobilePushTokens(database); err != nil {
		return err
	}

	return database.AutoMigrate(
		&models.Notification{},
		&models.PushSubscription{},
		&models.MobilePushToken{},
	)
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
