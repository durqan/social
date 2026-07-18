package db

import (
	"testing"
	"time"

	"tester/internal/models"
)

func TestNotificationMigrationBackfillsExistingRowsAsSeen(t *testing.T) {
	database := newBackendMigrationTestDB(t)
	if err := database.AutoMigrate(&notificationBeforeSeen{}); err != nil {
		t.Fatalf("create old notification table: %v", err)
	}
	if err := database.Create(&notificationBeforeSeen{
		RecipientID: 10,
		ActorID:     20,
		Type:        "friend_request",
		EntityID:    30,
		CreatedAt:   time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		DedupeKey:   "old-before-seen",
	}).Error; err != nil {
		t.Fatalf("seed old notification: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	var oldNotification models.Notification
	if err := database.First(
		&oldNotification,
		"dedupe_key = ?",
		"old-before-seen",
	).Error; err != nil {
		t.Fatalf("load old notification: %v", err)
	}
	if !oldNotification.IsSeen {
		t.Fatal("existing notification was not backfilled as seen")
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
		t.Fatal("new notification should default to unseen")
	}
}

func TestNotificationMigrationDeduplicatesTokensWithoutDroppingLegacyData(t *testing.T) {
	database := newBackendMigrationTestDB(t)
	if err := database.Exec(`
		CREATE TABLE push_subscriptions (
			id integer primary key autoincrement,
			user_id integer not null,
			endpoint text not null
		)
	`).Error; err != nil {
		t.Fatalf("create push_subscriptions: %v", err)
	}
	if err := database.Exec(`
		INSERT INTO push_subscriptions (user_id, endpoint)
		VALUES (10, 'https://push.example/subscription')
	`).Error; err != nil {
		t.Fatalf("seed push_subscriptions: %v", err)
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
		t.Fatalf("create mobile_push_tokens: %v", err)
	}
	if err := database.Exec(`
		INSERT INTO mobile_push_tokens (user_id, provider, platform, token)
		VALUES
			(10, 'fcm', 'android', 'same-token'),
			(11, 'fcm', 'android', 'same-token')
	`).Error; err != nil {
		t.Fatalf("seed duplicate tokens: %v", err)
	}

	if err := Migrate(database); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	if !database.Migrator().HasTable("push_subscriptions") {
		t.Fatal("migration destructively removed legacy production data")
	}
	var subscriptionCount int64
	if err := database.Table("push_subscriptions").Count(&subscriptionCount).Error; err != nil {
		t.Fatal(err)
	}
	if subscriptionCount != 1 {
		t.Fatalf("push subscription count = %d, want preserved row", subscriptionCount)
	}
	var tokens []models.MobilePushToken
	if err := database.Find(&tokens).Error; err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0].UserID != 11 {
		t.Fatalf("unexpected tokens after dedupe: %+v", tokens)
	}
}

type notificationBeforeSeen struct {
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

func (notificationBeforeSeen) TableName() string {
	return "notifications"
}
