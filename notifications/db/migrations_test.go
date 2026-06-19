package db

import (
	"fmt"
	"testing"

	"notifications/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCleanDatabaseIsRepeatable(t *testing.T) {
	database := newMigrationTestDB(t)

	if err := Migrate(database); err != nil {
		t.Fatalf("first Migrate failed: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("second Migrate failed: %v", err)
	}

	assertUniqueIndex(t, database, &models.PushSubscription{}, "idx_push_subscriptions_endpoint")
	assertUniqueIndex(t, database, &models.MobilePushToken{}, "idx_mobile_push_tokens_token")
}

func TestMigrateRemovesOldPushAndTokenDuplicates(t *testing.T) {
	database := newMigrationTestDB(t)
	if err := database.Exec(`
		CREATE TABLE push_subscriptions (
			id integer primary key autoincrement,
			user_id integer not null,
			endpoint text not null,
			p256dh text not null,
			auth text not null,
			created_at datetime,
			updated_at datetime
		)
	`).Error; err != nil {
		t.Fatalf("create old push_subscriptions: %v", err)
	}
	if err := database.Exec(`
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES
			(10, 'same-endpoint', 'old-key', 'old-auth'),
			(11, 'same-endpoint', 'new-key', 'new-auth')
	`).Error; err != nil {
		t.Fatalf("seed push duplicates: %v", err)
	}

	if err := database.Exec(`
		CREATE TABLE mobile_push_tokens (
			id integer primary key autoincrement,
			user_id integer not null,
			provider text not null,
			platform text not null,
			token text not null,
			revoked_at datetime,
			last_seen_at datetime,
			created_at datetime,
			updated_at datetime
		)
	`).Error; err != nil {
		t.Fatalf("create old mobile_push_tokens: %v", err)
	}
	if err := database.Exec(`
		INSERT INTO mobile_push_tokens (user_id, provider, platform, token)
		VALUES
			(10, 'fcm', 'android', 'same-token'),
			(11, 'fcm', 'android', 'same-token')
	`).Error; err != nil {
		t.Fatalf("seed mobile token duplicates: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate with duplicates failed: %v", err)
	}
	if err := Migrate(database); err != nil {
		t.Fatalf("repeated Migrate failed: %v", err)
	}

	var subscriptions []models.PushSubscription
	if err := database.Find(&subscriptions).Error; err != nil {
		t.Fatalf("load subscriptions: %v", err)
	}
	if len(subscriptions) != 1 || subscriptions[0].UserID != 11 {
		t.Fatalf("unexpected subscriptions after migration: %+v", subscriptions)
	}

	var tokens []models.MobilePushToken
	if err := database.Find(&tokens).Error; err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0].UserID != 11 {
		t.Fatalf("unexpected tokens after migration: %+v", tokens)
	}

	assertUniqueIndex(t, database, &models.PushSubscription{}, "idx_push_subscriptions_endpoint")
	assertUniqueIndex(t, database, &models.MobilePushToken{}, "idx_mobile_push_tokens_token")
}

func newMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return database
}

func assertUniqueIndex(t *testing.T, database *gorm.DB, model any, indexName string) {
	t.Helper()

	indexes, err := database.Migrator().GetIndexes(model)
	if err != nil {
		t.Fatalf("get indexes: %v", err)
	}
	for _, index := range indexes {
		if index.Name() != indexName {
			continue
		}
		unique, ok := index.Unique()
		if !ok || !unique {
			t.Fatalf("index %s is not unique", indexName)
		}
		return
	}
	t.Fatalf("missing unique index %s", indexName)
}
