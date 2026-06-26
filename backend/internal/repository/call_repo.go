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
const MaxStoredIceCandidates = 128

var ErrInvalidCallTransition = errors.New("invalid call transition")
var ErrCallBusy = errors.New("call participant is busy")

func NormalizeCallType(callType string) string {
	if strings.EqualFold(strings.TrimSpace(callType), models.CallTypeVideo) {
		return models.CallTypeVideo
	}
	return models.CallTypeAudio
}

func CreateCallOffer(db *gorm.DB, callerID, calleeID uint, callID string, callType string, conversationID *uint, offerPayload string) (*models.CallLog, []models.CallLog, bool, error) {
	callID = strings.TrimSpace(callID)
	if callerID == 0 || calleeID == 0 || callerID == calleeID || callID == "" {
		return nil, nil, false, ErrInvalidCallTransition
	}

	now := time.Now()
	expiresAt := now.Add(ActiveCallRecoveryTTL)
	var call models.CallLog
	var replaced []models.CallLog
	shouldForward := true
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("call_id = ? AND ((caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?))",
				callID, callerID, calleeID, calleeID, callerID).
			First(&call).Error; err == nil {
			if call.CallerID != callerID || call.CalleeID != calleeID || call.Status != models.CallStatusRinging {
				shouldForward = false
				return ErrInvalidCallTransition
			}
			if call.ExpiresAt != nil && !call.ExpiresAt.After(now) {
				shouldForward = false
				return ErrInvalidCallTransition
			}
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var busyCount int64
		if err := tx.Model(&models.CallLog{}).
			Where("(caller_id = ? OR callee_id = ? OR caller_id = ? OR callee_id = ?)", callerID, callerID, calleeID, calleeID).
			Where("status IN ?", []string{models.CallStatusRinging, models.CallStatusAnswered}).
			Where("NOT ((caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?))", callerID, calleeID, calleeID, callerID).
			Count(&busyCount).Error; err != nil {
			return err
		}
		if busyCount > 0 {
			shouldForward = false
			return ErrCallBusy
		}

		if err := activeCallPair(tx, callerID, calleeID).
			Where("status = ?", models.CallStatusRinging).
			Where("call_id <> ?", callID).
			Find(&replaced).Error; err != nil {
			return err
		}
		for _, previous := range replaced {
			if err := tx.Model(&models.CallLog{}).
				Where("id = ? AND status = ?", previous.ID, models.CallStatusRinging).
				Updates(map[string]interface{}{
					"status":   models.CallStatusReplaced,
					"ended_at": now,
				}).Error; err != nil {
				return err
			}
			previous.Status = models.CallStatusReplaced
			previous.EndedAt = &now
		}

		call = models.CallLog{
			CallID:         callID,
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
		return nil, replaced, false, err
	}
	return &call, replaced, shouldForward, nil
}

func FindCallForParticipant(db *gorm.DB, userID uint, callID string) (models.CallLog, error) {
	if userID == 0 || strings.TrimSpace(callID) == "" {
		return models.CallLog{}, gorm.ErrRecordNotFound
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
	_, err := ExpireStaleRingingCallsWithResult(db)
	return err
}

func ExpireStaleRingingCallsWithResult(db *gorm.DB) ([]models.CallLog, error) {
	now := time.Now()
	var expired []models.CallLog
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Preload("Caller").
			Preload("Callee").
			Where("status = ?", models.CallStatusRinging).
			Where("expires_at IS NOT NULL AND expires_at <= ?", now).
			Find(&expired).Error; err != nil {
			return err
		}
		if len(expired) == 0 {
			return nil
		}
		ids := make([]uint, 0, len(expired))
		for _, call := range expired {
			ids = append(ids, call.ID)
		}
		return tx.Model(&models.CallLog{}).
			Where("id IN ? AND status = ?", ids, models.CallStatusRinging).
			Updates(map[string]interface{}{
				"status":   models.CallStatusMissed,
				"ended_at": now,
			}).Error
	})
	if err != nil {
		return nil, err
	}
	for i := range expired {
		expired[i].Status = models.CallStatusMissed
		expired[i].EndedAt = &now
	}
	return expired, nil
}

func DebugCallDump(db *gorm.DB, userID uint, callID string) (models.CallLog, error) {
	call, err := FindCallForParticipant(db, userID, callID)
	if err != nil {
		return models.CallLog{}, err
	}
	call.OfferPayload = ""
	call.IceCandidates = ""
	return call, nil
}

func ForceExpireRingingCall(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
	call, err := findCallBetweenUsersByID(db, actorID, peerID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if call.Status != models.CallStatusRinging || callExpired(call) {
		return call, false, nil
	}
	now := time.Now()
	result := db.Model(&models.CallLog{}).
		Where("id = ? AND status = ?", call.ID, models.CallStatusRinging).
		Updates(map[string]interface{}{
			"status":   models.CallStatusMissed,
			"ended_at": now,
		})
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	call.Status = models.CallStatusMissed
	call.EndedAt = &now
	return call, true, nil
}

func MarkCallAnswered(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
	call, err := findCallBetweenUsersByID(db, actorID, peerID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if call.CalleeID != actorID || call.CallerID != peerID || call.Status != models.CallStatusRinging || callExpired(call) {
		return call, false, nil
	}

	now := time.Now()
	result := db.Model(&models.CallLog{}).
		Where("id = ? AND callee_id = ? AND status = ?", call.ID, actorID, models.CallStatusRinging).
		Updates(map[string]interface{}{
			"status":      models.CallStatusAnswered,
			"answered_at": now,
		})
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	return call, true, nil
}

func MarkCallDeclined(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
	call, err := findCallBetweenUsersByID(db, actorID, peerID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if call.CalleeID != actorID || call.CallerID != peerID || call.Status != models.CallStatusRinging || callExpired(call) {
		return call, false, nil
	}

	now := time.Now()
	result := db.Model(&models.CallLog{}).
		Where("id = ? AND callee_id = ? AND status = ?", call.ID, actorID, models.CallStatusRinging).
		Updates(map[string]interface{}{
			"status":   models.CallStatusDeclined,
			"ended_at": now,
		})
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	return call, true, nil
}

func MarkCallEnded(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
	call, err := findCallBetweenUsersByID(db, actorID, peerID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if !isCallParticipant(call, actorID) || !isCallParticipant(call, peerID) {
		return call, false, nil
	}
	if call.Status == models.CallStatusRinging && actorID != call.CallerID {
		return call, false, nil
	}
	if call.Status != models.CallStatusRinging && call.Status != models.CallStatusAnswered {
		return call, false, nil
	}

	now := time.Now()
	durationSeconds := 0
	if call.AnsweredAt != nil {
		durationSeconds = int(now.Sub(*call.AnsweredAt).Seconds())
		if durationSeconds < 0 {
			durationSeconds = 0
		}
	}

	result := db.Model(&models.CallLog{}).
		Where("id = ? AND (caller_id = ? OR callee_id = ?)", call.ID, actorID, actorID).
		Where("status IN ?", []string{models.CallStatusRinging, models.CallStatusAnswered}).
		Updates(map[string]interface{}{
			"status":           models.CallStatusEnded,
			"ended_at":         now,
			"duration_seconds": durationSeconds,
		})
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	return call, true, nil
}

func AppendCallIceCandidate(db *gorm.DB, fromID, toID uint, callID string, candidatePayload string) (models.CallLog, bool, error) {
	if strings.TrimSpace(callID) == "" || strings.TrimSpace(candidatePayload) == "" || !json.Valid([]byte(candidatePayload)) {
		return models.CallLog{}, false, nil
	}

	call, err := findCallBetweenUsersByID(db, fromID, toID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if !isCallParticipant(call, fromID) || !isCallParticipant(call, toID) {
		return call, false, nil
	}
	if call.Status != models.CallStatusRinging && call.Status != models.CallStatusAnswered {
		return call, false, nil
	}
	if call.Status == models.CallStatusRinging && callExpired(call) {
		return call, false, nil
	}

	var candidates []json.RawMessage
	if call.IceCandidates != "" {
		_ = json.Unmarshal([]byte(call.IceCandidates), &candidates)
	}
	if len(candidates) >= MaxStoredIceCandidates {
		return call, true, nil
	}
	candidates = append(candidates, json.RawMessage(candidatePayload))

	nextCandidates, err := json.Marshal(candidates)
	if err != nil {
		return call, false, err
	}

	err = db.Model(&models.CallLog{}).
		Where("id = ?", call.ID).
		Update("ice_candidates", string(nextCandidates)).Error
	if err != nil {
		return call, false, err
	}
	return call, true, nil
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

func findCallBetweenUsersByID(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, error) {
	var call models.CallLog
	callID = strings.TrimSpace(callID)
	if actorID == 0 || peerID == 0 || callID == "" {
		return call, gorm.ErrRecordNotFound
	}

	err := activeCallPair(db, actorID, peerID).
		Where("call_id = ?", callID).
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}

func isCallParticipant(call models.CallLog, userID uint) bool {
	return userID != 0 && (call.CallerID == userID || call.CalleeID == userID)
}

func callExpired(call models.CallLog) bool {
	return call.ExpiresAt != nil && !call.ExpiresAt.After(time.Now())
}
