package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

const ActiveCallRecoveryTTL = 5 * time.Minute

func NormalizeCallType(callType string) string {
	if strings.EqualFold(strings.TrimSpace(callType), models.CallTypeVideo) {
		return models.CallTypeVideo
	}
	return models.CallTypeAudio
}

func CreateCallOffer(db *gorm.DB, callerID, calleeID uint, callID string, callType string, conversationID *uint, offerPayload string) (*models.CallLog, error) {
	if callerID == 0 || calleeID == 0 || callerID == calleeID || strings.TrimSpace(callID) == "" {
		return nil, gorm.ErrRecordNotFound
	}

	now := time.Now()
	expiresAt := now.Add(ActiveCallRecoveryTTL)
	var call models.CallLog
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("call_id = ? AND ((caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?))",
				callID, callerID, calleeID, calleeID, callerID).
			First(&call).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if err := activeCallPair(tx, callerID, calleeID).
			Where("status = ?", models.CallStatusRinging).
			Where("call_id <> ?", callID).
			Updates(map[string]interface{}{
				"status":   models.CallStatusFailed,
				"ended_at": now,
			}).Error; err != nil {
			return err
		}

		call = models.CallLog{
			CallID:         strings.TrimSpace(callID),
			ConversationID: conversationID,
			CallerID:       callerID,
			CalleeID:       calleeID,
			CallType:       NormalizeCallType(callType),
			Status:         models.CallStatusRinging,
			OfferPayload:   offerPayload,
			StartedAt:      now,
			ExpiresAt:      &expiresAt,
		}
		return tx.Create(&call).Error
	})
	if err != nil {
		return nil, err
	}
	return &call, nil
}

func FindCallForParticipant(db *gorm.DB, userID uint, callID string) (models.CallLog, error) {
	if userID == 0 || strings.TrimSpace(callID) == "" {
		return models.CallLog{}, gorm.ErrRecordNotFound
	}

	if err := ExpireStaleRingingCalls(db); err != nil {
		return models.CallLog{}, err
	}

	var call models.CallLog
	err := db.
		Preload("Caller").
		Preload("Callee").
		Where("call_id = ? AND (caller_id = ? OR callee_id = ?)", strings.TrimSpace(callID), userID, userID).
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}

func FindActiveRingingCallForCallee(db *gorm.DB, calleeID uint) (models.CallLog, error) {
	if calleeID == 0 {
		return models.CallLog{}, gorm.ErrRecordNotFound
	}

	if err := ExpireStaleRingingCalls(db); err != nil {
		return models.CallLog{}, err
	}

	now := time.Now()
	var call models.CallLog
	err := db.
		Preload("Caller").
		Preload("Callee").
		Where("callee_id = ? AND status = ?", calleeID, models.CallStatusRinging).
		Where("expires_at IS NULL OR expires_at > ?", now).
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}

func ExpireStaleRingingCalls(db *gorm.DB) error {
	now := time.Now()
	return db.Model(&models.CallLog{}).
		Where("status = ?", models.CallStatusRinging).
		Where("expires_at IS NOT NULL AND expires_at <= ?", now).
		Updates(map[string]interface{}{
			"status":   models.CallStatusMissed,
			"ended_at": now,
		}).Error
}

func MarkCallAnswered(db *gorm.DB, actorID, peerID uint, callID string) error {
	call, err := findLatestCallBetweenUsers(db, actorID, peerID, callID, []string{models.CallStatusRinging})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	now := time.Now()
	return db.Model(&models.CallLog{}).
		Where("id = ? AND (caller_id = ? OR callee_id = ?)", call.ID, actorID, actorID).
		Updates(map[string]interface{}{
			"status":      models.CallStatusAnswered,
			"answered_at": now,
		}).Error
}

func MarkCallDeclined(db *gorm.DB, actorID, peerID uint, callID string) error {
	call, err := findLatestCallBetweenUsers(db, actorID, peerID, callID, []string{models.CallStatusRinging})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	now := time.Now()
	return db.Model(&models.CallLog{}).
		Where("id = ? AND (caller_id = ? OR callee_id = ?)", call.ID, actorID, actorID).
		Updates(map[string]interface{}{
			"status":   models.CallStatusDeclined,
			"ended_at": now,
		}).Error
}

func MarkCallEnded(db *gorm.DB, actorID, peerID uint, callID string) error {
	call, err := findLatestCallBetweenUsers(db, actorID, peerID, callID, []string{models.CallStatusRinging, models.CallStatusAnswered})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	now := time.Now()
	durationSeconds := 0
	if call.AnsweredAt != nil {
		durationSeconds = int(now.Sub(*call.AnsweredAt).Seconds())
		if durationSeconds < 0 {
			durationSeconds = 0
		}
	}

	return db.Model(&models.CallLog{}).
		Where("id = ? AND (caller_id = ? OR callee_id = ?)", call.ID, actorID, actorID).
		Updates(map[string]interface{}{
			"status":           models.CallStatusEnded,
			"ended_at":         now,
			"duration_seconds": durationSeconds,
		}).Error
}

func AppendCallIceCandidate(db *gorm.DB, fromID, toID uint, callID string, candidatePayload string) error {
	if strings.TrimSpace(callID) == "" || strings.TrimSpace(candidatePayload) == "" || !json.Valid([]byte(candidatePayload)) {
		return nil
	}

	call, err := findLatestCallBetweenUsers(
		db,
		fromID,
		toID,
		callID,
		[]string{models.CallStatusRinging, models.CallStatusAnswered},
	)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	var candidates []json.RawMessage
	if call.IceCandidates != "" {
		_ = json.Unmarshal([]byte(call.IceCandidates), &candidates)
	}
	candidates = append(candidates, json.RawMessage(candidatePayload))

	nextCandidates, err := json.Marshal(candidates)
	if err != nil {
		return err
	}

	return db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("ice_candidates", string(nextCandidates)).Error
}

func activeCallPair(db *gorm.DB, userID1, userID2 uint) *gorm.DB {
	return db.Model(&models.CallLog{}).Where(
		"(caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?)",
		userID1,
		userID2,
		userID2,
		userID1,
	)
}

func findLatestCallBetweenUsers(db *gorm.DB, actorID, peerID uint, callID string, statuses []string) (models.CallLog, error) {
	var call models.CallLog
	base := activeCallPair(db, actorID, peerID).
		Where("status IN ?", statuses)

	if strings.TrimSpace(callID) != "" {
		err := base.Session(&gorm.Session{}).
			Where("call_id = ?", strings.TrimSpace(callID)).
			Order("started_at DESC, id DESC").
			First(&call).Error
		if err == nil || !errors.Is(err, gorm.ErrRecordNotFound) {
			return call, err
		}
	}

	err := base.
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}
