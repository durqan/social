package handlers

import (
	"encoding/json"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestMessageReactionUpdateEventIsPersonalizedPerRecipient(t *testing.T) {
	db := newReactionEventTestDB(t)
	seedReactionEventUsers(t, db)

	message := models.Message{
		FromID:          1,
		ToID:            2,
		Content:         "hello",
		ReactionVersion: 1,
	}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MessageReaction{
		MessageID: message.ID,
		UserID:    1,
		Emoji:     "❤️",
	}).Error; err != nil {
		t.Fatal(err)
	}

	userA := decodeReactionEvent(t, db, message, 1)
	userB := decodeReactionEvent(t, db, message, 2)

	if userA.Payload.ConversationID != 2 || userB.Payload.ConversationID != 1 {
		t.Fatalf(
			"conversation ids = A:%d B:%d, want A:2 B:1",
			userA.Payload.ConversationID,
			userB.Payload.ConversationID,
		)
	}
	assertReactionEventSummary(t, userA, "❤️", 1, true, 1)
	assertReactionEventSummary(t, userB, "❤️", 1, false, 1)

	if err := db.Create(&models.MessageReaction{
		MessageID: message.ID,
		UserID:    2,
		Emoji:     "❤️",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&message).Update("reaction_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	message.ReactionVersion = 2

	userA = decodeReactionEvent(t, db, message, 1)
	userB = decodeReactionEvent(t, db, message, 2)
	assertReactionEventSummary(t, userA, "❤️", 2, true, 2)
	assertReactionEventSummary(t, userB, "❤️", 2, true, 2)

	if err := db.Where("message_id = ? AND user_id = ?", message.ID, 1).
		Delete(&models.MessageReaction{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&message).Update("reaction_version", 3).Error; err != nil {
		t.Fatal(err)
	}
	message.ReactionVersion = 3

	userA = decodeReactionEvent(t, db, message, 1)
	userB = decodeReactionEvent(t, db, message, 2)
	assertReactionEventSummary(t, userA, "❤️", 1, false, 3)
	assertReactionEventSummary(t, userB, "❤️", 1, true, 3)

	if err := db.Model(&models.MessageReaction{}).
		Where("message_id = ? AND user_id = ?", message.ID, 2).
		Update("emoji", "😂").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&message).Update("reaction_version", 4).Error; err != nil {
		t.Fatal(err)
	}
	message.ReactionVersion = 4

	userA = decodeReactionEvent(t, db, message, 1)
	userB = decodeReactionEvent(t, db, message, 2)
	assertReactionEventSummary(t, userA, "😂", 1, false, 4)
	assertReactionEventSummary(t, userB, "😂", 1, true, 4)
}

func TestMessageReactionUpdateEventSkipsMessageDeletedForRecipient(t *testing.T) {
	db := newReactionEventTestDB(t)
	seedReactionEventUsers(t, db)

	message := models.Message{FromID: 1, ToID: 2, Content: "hello", ReactionVersion: 1}
	if err := db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.MessageUserDeletion{
		MessageID: message.ID,
		UserID:    2,
		DeletedAt: time.Now(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	event, visible, err := messageReactionUpdateEvent(db, message, 2)
	if err != nil {
		t.Fatal(err)
	}
	if visible || event != nil {
		t.Fatalf("deleted recipient event visible=%v bytes=%q, want skipped", visible, event)
	}
}

type reactionEventEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		MessageID       uint                     `json:"message_id"`
		ConversationID  uint                     `json:"conversation_id"`
		ReactionVersion uint64                   `json:"reaction_version"`
		Reactions       []models.ReactionSummary `json:"reactions"`
	} `json:"payload"`
}

func decodeReactionEvent(t *testing.T, db *gorm.DB, message models.Message, userID uint) reactionEventEnvelope {
	t.Helper()

	eventBytes, visible, err := messageReactionUpdateEvent(db, message, userID)
	if err != nil {
		t.Fatal(err)
	}
	if !visible {
		t.Fatal("reaction event unexpectedly hidden")
	}
	var event reactionEventEnvelope
	if err := json.Unmarshal(eventBytes, &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "message:reaction" || event.Payload.MessageID != message.ID {
		t.Fatalf("unexpected reaction event: %+v", event)
	}
	return event
}

func assertReactionEventSummary(
	t *testing.T,
	event reactionEventEnvelope,
	emoji string,
	count int,
	reactedByMe bool,
	version uint64,
) {
	t.Helper()

	if event.Payload.ReactionVersion != version {
		t.Fatalf("reaction version = %d, want %d", event.Payload.ReactionVersion, version)
	}
	if len(event.Payload.Reactions) != 1 {
		t.Fatalf("reaction summaries = %+v, want one summary", event.Payload.Reactions)
	}
	summary := event.Payload.Reactions[0]
	if summary.Emoji != emoji || summary.Count != count || summary.ReactedByMe != reactedByMe {
		t.Fatalf(
			"reaction summary = %+v, want emoji=%s count=%d reactedByMe=%v",
			summary,
			emoji,
			count,
			reactedByMe,
		)
	}
}

func newReactionEventTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageReaction{},
		&models.MessageUserDeletion{},
		&models.MessageAttachment{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedReactionEventUsers(t *testing.T, db *gorm.DB) {
	t.Helper()

	if err := db.Create(&[]models.User{
		{ID: 1, Name: "A", Email: "a@example.com"},
		{ID: 2, Name: "B", Email: "b@example.com"},
	}).Error; err != nil {
		t.Fatal(err)
	}
}
