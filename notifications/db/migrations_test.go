package db

import (
	"fmt"
	"testing"
	"time"

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
	assertIndex(t, database, &models.Notification{}, "idx_notifications_recipient_conversation_type")
}

func TestMigrateBackfillsExistingNotificationsAsSeenAndKeepsNewDefaultUnseen(t *testing.T) {
	database := newMigrationTestDB(t)
	oldCreatedAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := database.AutoMigrate(&oldNotificationBeforeSeen{}); err != nil {
		t.Fatalf("create old notifications table: %v", err)
	}
	if err := database.Create(&oldNotificationBeforeSeen{
		RecipientID: 10,
		ActorID:     20,
		Type:        "friend_request",
		EntityID:    30,
		IsRead:      false,
		CreatedAt:   oldCreatedAt,
		DedupeKey:   "old-before-seen",
	}).Error; err != nil {
		t.Fatalf("seed old notification: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	var oldNotification models.Notification
	if err := database.First(&oldNotification, "dedupe_key = ?", "old-before-seen").Error; err != nil {
		t.Fatalf("load old notification: %v", err)
	}
	if !oldNotification.IsSeen {
		t.Fatal("expected existing notification to be backfilled as seen")
	}

	newNotification := models.Notification{
		RecipientID: 10,
		ActorID:     21,
		Type:        "friend_request",
		EntityID:    31,
		DedupeKey:   "new-after-seen",
	}
	if err := database.Create(&newNotification).Error; err != nil {
		t.Fatalf("create new notification: %v", err)
	}
	if err := database.First(&newNotification, newNotification.ID).Error; err != nil {
		t.Fatalf("reload new notification: %v", err)
	}
	if newNotification.IsSeen {
		t.Fatal("expected new notification after migration to default unseen")
	}

	var unseenCount int64
	if err := database.Model(&models.Notification{}).
		Where("recipient_id = ? AND is_seen = ?", 10, false).
		Count(&unseenCount).Error; err != nil {
		t.Fatalf("count unseen notifications: %v", err)
	}
	if unseenCount != 1 {
		t.Fatalf("unseen count = %d, want only the new notification", unseenCount)
	}
}

func TestMigrateBackfillsExistingNullSeenBeforeNotNullConstraint(t *testing.T) {
	database := newMigrationTestDB(t)
	if err := database.AutoMigrate(&oldNotificationWithNullableSeen{}); err != nil {
		t.Fatalf("create nullable is_seen notifications table: %v", err)
	}
	if err := database.Create(&oldNotificationWithNullableSeen{
		RecipientID: 10,
		ActorID:     20,
		Type:        "friend_request",
		EntityID:    30,
		IsRead:      false,
		IsSeen:      nil,
		CreatedAt:   time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		DedupeKey:   "old-null-seen",
	}).Error; err != nil {
		t.Fatalf("seed null seen notification: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	var got models.Notification
	if err := database.First(&got, "dedupe_key = ?", "old-null-seen").Error; err != nil {
		t.Fatalf("load migrated notification: %v", err)
	}
	if !got.IsSeen {
		t.Fatal("expected old NULL is_seen notification to become seen")
	}
	assertColumnNotNull(t, database, "notifications", "is_seen")
}

func TestMigrateRepairsAlreadyAppliedSeenColumnBeforeCutoff(t *testing.T) {
	database := newMigrationTestDB(t)
	cutoff := time.Date(2026, 1, 10, 12, 0, 0, 0, time.UTC)
	t.Setenv(notificationSeenRepairBeforeEnv, cutoff.Format(time.RFC3339))
	if err := database.AutoMigrate(&oldNotificationWithBadSeen{}); err != nil {
		t.Fatalf("create notifications table: %v", err)
	}
	if err := database.Create(&[]oldNotificationWithBadSeen{
		{
			RecipientID: 10,
			ActorID:     20,
			Type:        "friend_request",
			EntityID:    30,
			IsRead:      false,
			IsSeen:      false,
			CreatedAt:   cutoff.Add(-time.Hour),
			DedupeKey:   "old-bad-unseen",
		},
		{
			RecipientID: 10,
			ActorID:     21,
			Type:        "friend_request",
			EntityID:    31,
			IsRead:      false,
			IsSeen:      false,
			CreatedAt:   cutoff.Add(time.Hour),
			DedupeKey:   "new-real-unseen",
		},
	}).Error; err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	var notifications []models.Notification
	if err := database.Find(&notifications).Error; err != nil {
		t.Fatalf("load notifications: %v", err)
	}
	if len(notifications) != 2 {
		t.Fatalf("notifications length = %d, want 2", len(notifications))
	}
	byKey := make(map[string]models.Notification, len(notifications))
	for _, notification := range notifications {
		byKey[notification.DedupeKey] = notification
	}
	if !byKey["old-bad-unseen"].IsSeen {
		t.Fatal("expected old notification before repair cutoff to become seen")
	}
	if byKey["new-real-unseen"].IsSeen {
		t.Fatal("expected new notification after repair cutoff to stay unseen")
	}
}

type oldNotificationBeforeSeen struct {
	ID             uint `gorm:"primaryKey"`
	RecipientID    uint
	ActorID        uint
	Type           string
	EntityID       uint
	IsRead         bool
	CreatedAt      time.Time
	DedupeKey      string `gorm:"size:128;uniqueIndex"`
	CallID         string
	ConversationID uint
}

func (oldNotificationBeforeSeen) TableName() string {
	return "notifications"
}

type oldNotificationWithBadSeen struct {
	ID             uint `gorm:"primaryKey"`
	RecipientID    uint
	ActorID        uint
	Type           string
	EntityID       uint
	IsRead         bool
	IsSeen         bool `gorm:"default:false"`
	CreatedAt      time.Time
	DedupeKey      string `gorm:"size:128;uniqueIndex"`
	CallID         string
	ConversationID uint
}

func (oldNotificationWithBadSeen) TableName() string {
	return "notifications"
}

type oldNotificationWithNullableSeen struct {
	ID             uint `gorm:"primaryKey"`
	RecipientID    uint
	ActorID        uint
	Type           string
	EntityID       uint
	IsRead         bool
	IsSeen         *bool
	CreatedAt      time.Time
	DedupeKey      string `gorm:"size:128;uniqueIndex"`
	CallID         string
	ConversationID uint
}

func (oldNotificationWithNullableSeen) TableName() string {
	return "notifications"
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

func assertIndex(t *testing.T, database *gorm.DB, model any, indexName string) {
	t.Helper()

	indexes, err := database.Migrator().GetIndexes(model)
	if err != nil {
		t.Fatalf("get indexes: %v", err)
	}
	for _, index := range indexes {
		if index.Name() == indexName {
			return
		}
	}
	t.Fatalf("missing index %s", indexName)
}

func assertColumnNotNull(t *testing.T, database *gorm.DB, tableName string, columnName string) {
	t.Helper()

	columns, err := database.Migrator().ColumnTypes(tableName)
	if err != nil {
		t.Fatalf("get column types: %v", err)
	}
	for _, column := range columns {
		if column.Name() != columnName {
			continue
		}
		nullable, ok := column.Nullable()
		if !ok {
			t.Fatalf("column %s nullability is unknown", columnName)
		}
		if nullable {
			t.Fatalf("column %s is nullable", columnName)
		}
		return
	}
	t.Fatalf("missing column %s", columnName)
}
