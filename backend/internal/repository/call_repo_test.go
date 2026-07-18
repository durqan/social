package repository

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCreateCallDeduplicatesCallID(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	first, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, _, shouldNotify, err := CreateCall(db, 1, 2, "call-1", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || shouldNotify {
		t.Fatalf("duplicate call result = ids %d/%d notify=%t", first.ID, second.ID, shouldNotify)
	}
}

func TestCreateCallReplacesPreviousRingingCallForSamePair(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	first, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	second, replaced, _, err := CreateCall(db, 2, 1, "call-2", models.CallTypeVideo, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID || len(replaced) != 1 || replaced[0].CallID != first.CallID {
		t.Fatalf("unexpected replacement: first=%d second=%d replaced=%#v", first.ID, second.ID, replaced)
	}

	var stored models.CallLog
	if err := db.First(&stored, first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.CallStatusReplaced || stored.EndedAt == nil {
		t.Fatalf("replaced call = status %q ended_at %v", stored.Status, stored.EndedAt)
	}
}

func TestCallAcceptedAndEndedLifecycle(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallAccepted(db, 2, 1, call.CallID); err != nil || !changed {
		t.Fatalf("accept: changed=%t err=%v", changed, err)
	}
	acceptedAt := time.Now().Add(-3 * time.Second)
	if err := db.Model(&models.CallLog{}).Where("id = ?", call.ID).Update("accepted_at", acceptedAt).Error; err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallEnded(db, 1, 2, call.CallID); err != nil || !changed {
		t.Fatalf("end: changed=%t err=%v", changed, err)
	}

	var ended models.CallLog
	if err := db.First(&ended, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ended.Status != models.CallStatusEnded || ended.EndedAt == nil || ended.DurationSeconds <= 0 {
		t.Fatalf("ended call = status %q ended_at %v duration %d", ended.Status, ended.EndedAt, ended.DurationSeconds)
	}
}

func TestCallRejected(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallRejected(db, 2, 1, call.CallID); err != nil || !changed {
		t.Fatalf("reject: changed=%t err=%v", changed, err)
	}

	var rejected models.CallLog
	if err := db.First(&rejected, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if rejected.Status != models.CallStatusRejected || rejected.EndedAt == nil {
		t.Fatalf("rejected call = status %q ended_at %v", rejected.Status, rejected.EndedAt)
	}
}

func TestFindActiveCallReturnsBusinessStateOnly(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)
	conversationID := uint(1)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeVideo, &conversationID)
	if err != nil {
		t.Fatal(err)
	}
	active, err := FindActiveCallForUser(db, 2)
	if err != nil {
		t.Fatal(err)
	}
	if active.CallID != call.CallID || active.CallType != models.CallTypeVideo ||
		active.ConversationID == nil || *active.ConversationID != conversationID {
		t.Fatalf("active call = %#v", active)
	}
}

func TestCallTransitionsRequireParticipantAndRole(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallRejected(db, 3, 1, call.CallID); err != nil || changed {
		t.Fatalf("outsider reject: changed=%t err=%v", changed, err)
	}
	if _, changed, err := MarkCallAccepted(db, 1, 2, call.CallID); err != nil || changed {
		t.Fatalf("caller accept: changed=%t err=%v", changed, err)
	}
}

func TestCreateCallRejectsBusyParticipant(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	if _, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := CreateCall(db, 3, 2, "call-2", models.CallTypeAudio, nil); !errors.Is(err, ErrCallBusy) {
		t.Fatalf("busy call err = %v", err)
	}
}

func TestCreateCallExpiresStaleAcceptedParticipant(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	stale, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallAccepted(db, 2, 1, stale.CallID); err != nil || !changed {
		t.Fatalf("accept: changed=%t err=%v", changed, err)
	}
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", stale.ID).
		Update("updated_at", time.Now().Add(-ActiveCallHeartbeatTTL-time.Second)).Error; err != nil {
		t.Fatal(err)
	}

	if _, _, _, err := CreateCall(db, 3, 2, "call-2", models.CallTypeAudio, nil); err != nil {
		t.Fatal(err)
	}
	var stored models.CallLog
	if err := db.First(&stored, stale.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.CallStatusEnded {
		t.Fatalf("stale accepted status = %q", stored.Status)
	}
}

func TestHeartbeatKeepsAcceptedCallFresh(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallAccepted(db, 2, 1, call.CallID); err != nil || !changed {
		t.Fatalf("accept: changed=%t err=%v", changed, err)
	}
	staleAt := time.Now().Add(-ActiveCallHeartbeatTTL - time.Second)
	if err := db.Model(&models.CallLog{}).Where("id = ?", call.ID).Update("updated_at", staleAt).Error; err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallHeartbeat(db, 1, 2, call.CallID); err != nil || !changed {
		t.Fatalf("heartbeat: changed=%t err=%v", changed, err)
	}
	if _, _, _, err := CreateCall(db, 3, 2, "call-2", models.CallTypeAudio, nil); !errors.Is(err, ErrCallBusy) {
		t.Fatalf("fresh accepted call should remain busy: %v", err)
	}
}

func TestExpireStaleRingingCalls(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	expired, err := ExpireStaleRingingCallsWithResult(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 1 || expired[0].Status != models.CallStatusTimeout {
		t.Fatalf("expired calls = %#v", expired)
	}
	if _, changed, err := MarkCallAccepted(db, 2, 1, call.CallID); err != nil || changed {
		t.Fatalf("timed-out accept: changed=%t err=%v", changed, err)
	}
}

func TestFindActiveCallForBothParticipants(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCall(db, 1, 2, "call-1", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallAccepted(db, 2, 1, call.CallID); err != nil || !changed {
		t.Fatalf("accept: changed=%t err=%v", changed, err)
	}
	for _, userID := range []uint{1, 2} {
		active, err := FindActiveCallForUser(db, userID)
		if err != nil {
			t.Fatal(err)
		}
		if active.CallID != call.CallID || active.Status != models.CallStatusAccepted {
			t.Fatalf("user %d active call = %s/%s", userID, active.CallID, active.Status)
		}
	}
}

func TestStaleCallIDDoesNotAffectNewCall(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	oldCall, _, _, err := CreateCall(db, 1, 2, "call-old", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallEnded(db, 1, 2, oldCall.CallID); err != nil || !changed {
		t.Fatalf("end old: changed=%t err=%v", changed, err)
	}
	activeCall, _, _, err := CreateCall(db, 1, 2, "call-new", models.CallTypeAudio, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, changed, err := MarkCallRejected(db, 2, 1, oldCall.CallID); err != nil || changed {
		t.Fatalf("stale reject: changed=%t err=%v", changed, err)
	}
	var active models.CallLog
	if err := db.First(&active, activeCall.ID).Error; err != nil {
		t.Fatal(err)
	}
	if active.Status != models.CallStatusRinging {
		t.Fatalf("new call status = %q", active.Status)
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
