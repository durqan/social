package repository

import (
	"fmt"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCreateCallOfferDedupesByCallID(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	first, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("duplicate call_id created different call logs: %d != %d", first.ID, second.ID)
	}

	var count int64
	if err := db.Model(&models.CallLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("call_logs count = %d, want 1", count)
	}
}

func TestCreateCallOfferFailsPreviousActiveRingingBetweenUsers(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	first, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CreateCallOffer(db, 2, 1, "call-2", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("expected a new call log for a different call_id")
	}

	var previous models.CallLog
	if err := db.First(&previous, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if previous.Status != models.CallStatusFailed {
		t.Fatalf("previous call status = %q, want %q", previous.Status, models.CallStatusFailed)
	}
	if previous.EndedAt == nil {
		t.Fatal("previous failed call should have ended_at")
	}

	var active models.CallLog
	if err := db.First(&active, second.ID).Error; err != nil {
		t.Fatal(err)
	}
	if active.Status != models.CallStatusRinging {
		t.Fatalf("new call status = %q, want %q", active.Status, models.CallStatusRinging)
	}
	if active.CallType != models.CallTypeVideo {
		t.Fatalf("new call type = %q, want %q", active.CallType, models.CallTypeVideo)
	}
}

func TestCallAnswerAndEndLifecycle(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	}

	answeredAt := time.Now().Add(-3 * time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("answered_at", answeredAt).Error; err != nil {
		t.Fatal(err)
	}

	if err := MarkCallEnded(db, 1, 2, "call-1"); err != nil {
		t.Fatal(err)
	}

	var ended models.CallLog
	if err := db.First(&ended, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ended.Status != models.CallStatusEnded {
		t.Fatalf("call status = %q, want %q", ended.Status, models.CallStatusEnded)
	}
	if ended.EndedAt == nil {
		t.Fatal("ended call should have ended_at")
	}
	if ended.DurationSeconds <= 0 {
		t.Fatalf("duration_seconds = %d, want > 0", ended.DurationSeconds)
	}
}

func TestCallRejectMarksDeclined(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkCallDeclined(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	}

	var declined models.CallLog
	if err := db.First(&declined, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if declined.Status != models.CallStatusDeclined {
		t.Fatalf("call status = %q, want %q", declined.Status, models.CallStatusDeclined)
	}
	if declined.EndedAt == nil {
		t.Fatal("declined call should have ended_at")
	}
}

func TestCallStatusUpdateRequiresParticipant(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkCallDeclined(db, 3, 1, "call-1"); err != nil {
		t.Fatal(err)
	}

	var unchanged models.CallLog
	if err := db.First(&unchanged, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Status != models.CallStatusRinging {
		t.Fatalf("non-participant changed call status to %q", unchanged.Status)
	}
}

func newCallRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.CallLog{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedCallUsers(t *testing.T, db *gorm.DB, ids ...uint) {
	t.Helper()

	for _, id := range ids {
		if err := db.Create(&models.User{
			ID:       id,
			Name:     "User",
			Email:    fmt.Sprintf("user%d@example.com", id),
			Password: "x",
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
}
