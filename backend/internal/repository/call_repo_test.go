package repository

import (
	"encoding/json"
	"errors"
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

	first, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, nil, `{"type":"offer","sdp":"first"}`)
	if err != nil {
		t.Fatal(err)
	}
	second, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, nil, `{"type":"offer","sdp":"second"}`)
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

func TestCreateCallOfferReplacesPreviousActiveRingingBetweenUsers(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	first, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	second, replaced, _, err := CreateCallOffer(db, 2, 1, "call-2", models.CallTypeVideo, nil, "")
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
	if len(replaced) != 1 || replaced[0].CallID != "call-1" {
		t.Fatalf("replaced calls = %#v, want call-1", replaced)
	}
	if previous.Status != models.CallStatusReplaced {
		t.Fatalf("previous call status = %q, want %q", previous.Status, models.CallStatusReplaced)
	}
	if previous.EndedAt == nil {
		t.Fatal("previous replaced call should have ended_at")
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

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	answer := `{"type":"answer","sdp":"answer-sdp"}`
	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1", answer); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition to be forwarded")
	}

	answeredAt := time.Now().Add(-3 * time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("answered_at", answeredAt).Error; err != nil {
		t.Fatal(err)
	}

	if _, ok, err := MarkCallEnded(db, 1, 2, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected end transition to be forwarded")
	}

	var ended models.CallLog
	if err := db.First(&ended, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ended.AnswerPayload != answer {
		t.Fatalf("answer payload = %q, want %q", ended.AnswerPayload, answer)
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

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallDeclined(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected reject transition to be forwarded")
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

func TestFindActiveRingingCallForCalleeReturnsRecoveryPayload(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	conversationID := uint(1)
	offer := `{"type":"offer","sdp":"offer-sdp"}`
	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, &conversationID, offer)
	if err != nil {
		t.Fatal(err)
	}
	if call.ExpiresAt == nil {
		t.Fatal("call should have expires_at for stale recovery filtering")
	}
	if _, ok, err := AppendCallIceCandidate(db, 1, 2, "call-1", `{"candidate":"candidate:1 1 udp 1 127.0.0.1 10000 typ host"}`); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected ice transition to be forwarded")
	}

	active, err := FindActiveRingingCallForCallee(db, 2)
	if err != nil {
		t.Fatal(err)
	}
	if active.CallID != "call-1" {
		t.Fatalf("active call id = %q, want call-1", active.CallID)
	}
	if active.ConversationID == nil || *active.ConversationID != conversationID {
		t.Fatalf("conversation id = %v, want %d", active.ConversationID, conversationID)
	}
	if active.OfferPayload != offer {
		t.Fatalf("offer payload = %q, want %q", active.OfferPayload, offer)
	}
	if active.IceCandidates == "" {
		t.Fatal("expected stored ICE candidates")
	}
}

func TestAppendCallIceCandidateDedupesByCandidateAndFromID(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	if _, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeVideo, nil, ""); err != nil {
		t.Fatal(err)
	}

	firstCandidate := `{"candidate":"candidate:1 1 udp 1 127.0.0.1 10000 typ host","sdpMid":"0","sdpMLineIndex":0}`
	if _, ok, err := AppendCallIceCandidate(db, 1, 2, "call-1", firstCandidate); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected first ice transition to be forwarded")
	}
	if _, ok, err := AppendCallIceCandidate(db, 1, 2, "call-1", firstCandidate); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected duplicate ice transition to stay forwardable")
	}
	if _, ok, err := AppendCallIceCandidate(db, 2, 1, "call-1", firstCandidate); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected same candidate from peer to be stored separately")
	}

	active, err := FindCallForParticipant(db, 1, "call-1")
	if err != nil {
		t.Fatal(err)
	}

	var candidates []map[string]any
	if err := json.Unmarshal([]byte(active.IceCandidates), &candidates); err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 2 {
		t.Fatalf("stored ice candidate count = %d, want 2", len(candidates))
	}
	if candidates[0]["from_id"] != float64(1) {
		t.Fatalf("first from_id = %v, want 1", candidates[0]["from_id"])
	}
	if candidates[1]["from_id"] != float64(2) {
		t.Fatalf("second from_id = %v, want 2", candidates[1]["from_id"])
	}
}

func TestCallStatusUpdateRequiresParticipant(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallDeclined(db, 3, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("non-participant reject should not be forwarded")
	}

	var unchanged models.CallLog
	if err := db.First(&unchanged, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Status != models.CallStatusRinging {
		t.Fatalf("non-participant changed call status to %q", unchanged.Status)
	}
}

func TestCreateCallOfferRejectsBusyParticipant(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	if _, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := CreateCallOffer(db, 3, 2, "call-2", models.CallTypeAudio, nil, ""); !errors.Is(err, ErrCallBusy) {
		t.Fatalf("second call err = %v, want ErrCallBusy", err)
	}

	var count int64
	if err := db.Model(&models.CallLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("call_logs count = %d, want 1", count)
	}
}

func TestCreateCallOfferRejectsBusyAnsweredSamePair(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	if _, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition")
	}

	if _, _, _, err := CreateCallOffer(db, 1, 2, "call-2", models.CallTypeAudio, nil, ""); !errors.Is(err, ErrCallBusy) {
		t.Fatalf("second same-pair offer err = %v, want ErrCallBusy", err)
	}

	var count int64
	if err := db.Model(&models.CallLog{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("call_logs count = %d, want 1", count)
	}
}

func TestCreateCallOfferExpiresStaleAnsweredParticipantBeforeBusyCheck(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	staleCall, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition")
	}

	staleUpdatedAt := time.Now().Add(-ActiveCallHeartbeatTTL - time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", staleCall.ID).
		Update("updated_at", staleUpdatedAt).Error; err != nil {
		t.Fatal(err)
	}

	newCall, _, _, err := CreateCallOffer(db, 3, 2, "call-2", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if newCall.CallID != "call-2" {
		t.Fatalf("new call id = %q, want call-2", newCall.CallID)
	}

	var ended models.CallLog
	if err := db.First(&ended, staleCall.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ended.Status != models.CallStatusEnded {
		t.Fatalf("stale answered call status = %q, want ended", ended.Status)
	}
	if ended.EndedAt == nil {
		t.Fatal("stale answered call should have ended_at")
	}
}

func TestMarkCallHeartbeatKeepsAnsweredCallFresh(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition")
	}

	staleUpdatedAt := time.Now().Add(-ActiveCallHeartbeatTTL - time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("updated_at", staleUpdatedAt).Error; err != nil {
		t.Fatal(err)
	}

	if _, ok, err := MarkCallHeartbeat(db, 1, 2, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected heartbeat to refresh answered call")
	}

	if _, _, _, err := CreateCallOffer(db, 3, 2, "call-2", models.CallTypeAudio, nil, ""); !errors.Is(err, ErrCallBusy) {
		t.Fatalf("new offer err = %v, want ErrCallBusy", err)
	}

	var fresh models.CallLog
	if err := db.First(&fresh, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if fresh.Status != models.CallStatusAnswered {
		t.Fatalf("fresh heartbeat call status = %q, want answered", fresh.Status)
	}
	if !fresh.UpdatedAt.After(staleUpdatedAt) {
		t.Fatalf("heartbeat did not refresh updated_at: got %s, stale %s", fresh.UpdatedAt, staleUpdatedAt)
	}
}

func TestExpireStaleRingingCallsWithResult(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	expiredAt := time.Now().Add(-time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("expires_at", expiredAt).Error; err != nil {
		t.Fatal(err)
	}

	expired, err := ExpireStaleRingingCallsWithResult(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(expired) != 1 || expired[0].CallID != "call-1" {
		t.Fatalf("expired calls = %#v, want call-1", expired)
	}
	if expired[0].Status != models.CallStatusMissed {
		t.Fatalf("expired status = %q, want missed", expired[0].Status)
	}
}

func TestExpiredCallCannotBeAnswered(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	expiredAt := time.Now().Add(-time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("expires_at", expiredAt).Error; err != nil {
		t.Fatal(err)
	}

	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("expired answer should not be forwarded")
	}

	var unchanged models.CallLog
	if err := db.First(&unchanged, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Status != models.CallStatusRinging {
		t.Fatalf("expired answer changed status to %q", unchanged.Status)
	}
}

func TestFindActiveCallForUserReturnsOutgoingRingingAndAnswered(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	if _, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, ""); err != nil {
		t.Fatal(err)
	}

	outgoing, err := FindActiveCallForUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if outgoing.CallID != "call-1" || outgoing.Status != models.CallStatusRinging {
		t.Fatalf("caller active call = %s/%s, want call-1/ringing", outgoing.CallID, outgoing.Status)
	}

	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition")
	}

	for _, userID := range []uint{1, 2} {
		active, err := FindActiveCallForUser(db, userID)
		if err != nil {
			t.Fatal(err)
		}
		if active.CallID != "call-1" || active.Status != models.CallStatusAnswered {
			t.Fatalf("user %d active call = %s/%s, want call-1/answered", userID, active.CallID, active.Status)
		}
	}

	if _, ok, err := MarkCallEnded(db, 1, 2, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected end transition")
	}

	if _, err := FindActiveCallForUser(db, 1); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("ended call active lookup err = %v, want record not found", err)
	}
}

func TestEndActiveCallsForOfflineUserEndsAnsweredCall(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallAnswered(db, 2, 1, "call-1"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected answer transition")
	}

	answeredAt := time.Now().Add(-3 * time.Second)
	if err := db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("answered_at", answeredAt).Error; err != nil {
		t.Fatal(err)
	}

	ended, err := EndActiveCallsForOfflineUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(ended) != 1 || ended[0].CallID != "call-1" {
		t.Fatalf("ended calls = %#v, want call-1", ended)
	}

	var stored models.CallLog
	if err := db.First(&stored, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.CallStatusEnded {
		t.Fatalf("call status = %q, want ended", stored.Status)
	}
	if stored.EndedAt == nil {
		t.Fatal("offline-ended call should have ended_at")
	}
	if stored.DurationSeconds <= 0 {
		t.Fatalf("duration_seconds = %d, want > 0", stored.DurationSeconds)
	}

	if _, _, _, err := CreateCallOffer(db, 3, 1, "call-2", models.CallTypeAudio, nil, ""); err != nil {
		t.Fatalf("new offer after offline cleanup err = %v, want nil", err)
	}
}

func TestEndActiveCallsForOfflineUserEndsOutgoingRingingCall(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2, 3)

	call, _, _, err := CreateCallOffer(db, 1, 2, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	ended, err := EndActiveCallsForOfflineUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(ended) != 1 || ended[0].CallID != "call-1" {
		t.Fatalf("ended calls = %#v, want call-1", ended)
	}

	var stored models.CallLog
	if err := db.First(&stored, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.CallStatusEnded {
		t.Fatalf("outgoing ringing call status = %q, want ended", stored.Status)
	}

	if _, _, _, err := CreateCallOffer(db, 3, 1, "call-2", models.CallTypeAudio, nil, ""); err != nil {
		t.Fatalf("new offer after outgoing ringing cleanup err = %v, want nil", err)
	}
}

func TestEndActiveCallsForOfflineUserKeepsIncomingRingingCall(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	call, _, _, err := CreateCallOffer(db, 2, 1, "call-1", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	ended, err := EndActiveCallsForOfflineUser(db, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(ended) != 0 {
		t.Fatalf("ended calls = %#v, want none", ended)
	}

	var stored models.CallLog
	if err := db.First(&stored, call.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != models.CallStatusRinging {
		t.Fatalf("incoming ringing call status = %q, want ringing", stored.Status)
	}
}

func TestStaleCallIDDoesNotFallbackToLatestActiveCall(t *testing.T) {
	db := newCallRepoTestDB(t)
	seedCallUsers(t, db, 1, 2)

	oldCall, _, _, err := CreateCallOffer(db, 1, 2, "call-old", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := MarkCallEnded(db, 1, 2, "call-old"); err != nil {
		t.Fatal(err)
	} else if !ok {
		t.Fatal("expected old call to end")
	}

	activeCall, _, _, err := CreateCallOffer(db, 1, 2, "call-new", models.CallTypeAudio, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if _, ok, err := MarkCallDeclined(db, 2, 1, "call-old"); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("stale reject should not be forwarded")
	}
	if _, ok, err := AppendCallIceCandidate(db, 1, 2, "call-old", `{"candidate":"candidate:old"}`); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("stale ice should not be forwarded")
	}

	var active models.CallLog
	if err := db.First(&active, activeCall.ID).Error; err != nil {
		t.Fatal(err)
	}
	if active.Status != models.CallStatusRinging {
		t.Fatalf("active call status = %q, want ringing", active.Status)
	}
	if active.IceCandidates != "" {
		t.Fatal("stale ice candidate was appended to active call")
	}

	var old models.CallLog
	if err := db.First(&old, oldCall.ID).Error; err != nil {
		t.Fatal(err)
	}
	if old.Status != models.CallStatusEnded {
		t.Fatalf("old call status = %q, want ended", old.Status)
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
