package repository

import (
	"errors"
	"strings"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const ActiveCallRecoveryTTL = 5 * time.Minute
const ActiveCallHeartbeatTTL = 90 * time.Second

var ErrInvalidCallTransition = errors.New("invalid call transition")
var ErrCallBusy = errors.New("call participant is busy")

func NormalizeCallType(callType string) string {
	if strings.EqualFold(strings.TrimSpace(callType), models.CallTypeVideo) {
		return models.CallTypeVideo
	}
	return models.CallTypeAudio
}

func CreateCall(db *gorm.DB, callerID, calleeID uint, callID string, callType string, conversationID *uint) (*models.CallLog, []models.CallLog, bool, error) {
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
				_ = markCallsTimedOutByID(tx, now, call.ID)
				shouldForward = false
				return ErrInvalidCallTransition
			}
			shouldForward = false
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		if _, err := expireStaleAcceptedCallsForUsers(tx, now, callerID, calleeID); err != nil {
			return err
		}
		if err := expireStaleRingingCallsForUsers(tx, now, callerID, calleeID); err != nil {
			return err
		}

		var active []models.CallLog
		if err := tx.Model(&models.CallLog{}).
			Where("(caller_id IN ? OR callee_id IN ?)", []uint{callerID, calleeID}, []uint{callerID, calleeID}).
			Where("status = ? OR (status = ? AND (expires_at IS NULL OR expires_at > ?))", models.CallStatusAccepted, models.CallStatusRinging, now).
			Find(&active).Error; err != nil {
			return err
		}

		for _, existing := range active {
			if existing.Status == models.CallStatusAccepted {
				shouldForward = false
				return ErrCallBusy
			}
			if existing.CallID == callID {
				shouldForward = false
				return ErrInvalidCallTransition
			}
			if sameCallPair(existing, callerID, calleeID) && existing.Status == models.CallStatusRinging {
				replaced = append(replaced, existing)
				continue
			}

			shouldForward = false
			return ErrCallBusy
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
		Preload("Caller", preloadPublicUser).
		Preload("Callee", preloadPublicUser).
		Where("call_id = ? AND (caller_id = ? OR callee_id = ?)", strings.TrimSpace(callID), userID, userID).
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}

func FindCallByID(db *gorm.DB, callID string) (models.CallLog, error) {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return models.CallLog{}, gorm.ErrRecordNotFound
	}

	var call models.CallLog
	err := db.
		Preload("Caller", preloadPublicUser).
		Preload("Callee", preloadPublicUser).
		Where("call_id = ?", callID).
		First(&call).Error
	return call, err
}

func FindActiveCallForUser(db *gorm.DB, userID uint) (models.CallLog, error) {
	if userID == 0 {
		return models.CallLog{}, gorm.ErrRecordNotFound
	}

	now := time.Now()
	var call models.CallLog
	err := db.
		Preload("Caller", preloadPublicUser).
		Preload("Callee", preloadPublicUser).
		Where("(caller_id = ? OR callee_id = ?)", userID, userID).
		Where("status = ? OR (status = ? AND (expires_at IS NULL OR expires_at > ?))", models.CallStatusAccepted, models.CallStatusRinging, now).
		Order("started_at DESC, id DESC").
		First(&call).Error
	return call, err
}

func ExpireStaleRingingCallsWithResult(db *gorm.DB) ([]models.CallLog, error) {
	now := time.Now()
	var expired []models.CallLog
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Preload("Caller", preloadPublicUser).
			Preload("Callee", preloadPublicUser).
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
				"status":   models.CallStatusTimeout,
				"ended_at": now,
			}).Error
	})
	if err != nil {
		return nil, err
	}
	for i := range expired {
		expired[i].Status = models.CallStatusTimeout
		expired[i].EndedAt = &now
	}
	return expired, nil
}

func ExpireStaleAcceptedCallsWithResult(db *gorm.DB) ([]models.CallLog, error) {
	return expireStaleAcceptedCallsForUsers(db, time.Now())
}

func MarkCallHeartbeat(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
	call, err := findCallBetweenUsersByID(db, actorID, peerID, callID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.CallLog{}, false, nil
	}
	if err != nil {
		return models.CallLog{}, false, err
	}
	if !isCallParticipant(call, actorID) || !isCallParticipant(call, peerID) || call.Status != models.CallStatusAccepted {
		return call, false, nil
	}

	now := time.Now()
	result := db.Model(&models.CallLog{}).
		Where("id = ? AND status = ?", call.ID, models.CallStatusAccepted).
		Update("updated_at", now)
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	call.UpdatedAt = now
	return call, true, nil
}

func MarkCallAccepted(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
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
	updates := map[string]interface{}{
		"status":      models.CallStatusAccepted,
		"accepted_at": now,
	}

	result := db.Model(&models.CallLog{}).
		Where("id = ? AND callee_id = ? AND status = ?", call.ID, actorID, models.CallStatusRinging).
		Where("expires_at IS NULL OR expires_at > ?", now).
		Updates(updates)
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	call.Status = models.CallStatusAccepted
	call.AcceptedAt = &now
	return call, true, nil
}

func MarkCallRejected(db *gorm.DB, actorID, peerID uint, callID string) (models.CallLog, bool, error) {
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
		Where("expires_at IS NULL OR expires_at > ?", now).
		Updates(map[string]interface{}{
			"status":   models.CallStatusRejected,
			"ended_at": now,
		})
	if result.Error != nil {
		return call, false, result.Error
	}
	if result.RowsAffected == 0 {
		return call, false, nil
	}
	call.Status = models.CallStatusRejected
	call.EndedAt = &now
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
	if call.Status != models.CallStatusRinging && call.Status != models.CallStatusAccepted {
		return call, false, nil
	}

	now := time.Now()
	durationSeconds := callDurationSeconds(call, now)

	result := db.Model(&models.CallLog{}).
		Where("id = ? AND (caller_id = ? OR callee_id = ?)", call.ID, actorID, actorID).
		Where("status IN ?", []string{models.CallStatusRinging, models.CallStatusAccepted}).
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
	call.Status = models.CallStatusEnded
	call.EndedAt = &now
	call.DurationSeconds = durationSeconds
	return call, true, nil
}

func expireStaleRingingCallsForUsers(db *gorm.DB, now time.Time, userIDs ...uint) error {
	ids := make([]uint, 0, len(userIDs))
	seen := make(map[uint]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		ids = append(ids, userID)
	}
	if len(ids) == 0 {
		return nil
	}

	return db.Model(&models.CallLog{}).
		Where("(caller_id IN ? OR callee_id IN ?)", ids, ids).
		Where("status = ?", models.CallStatusRinging).
		Where("expires_at IS NOT NULL AND expires_at <= ?", now).
		Updates(map[string]interface{}{
			"status":   models.CallStatusTimeout,
			"ended_at": now,
		}).Error
}

func markCallsTimedOutByID(db *gorm.DB, now time.Time, ids ...uint) error {
	if len(ids) == 0 {
		return nil
	}
	return db.Model(&models.CallLog{}).
		Where("id IN ? AND status = ?", ids, models.CallStatusRinging).
		Updates(map[string]interface{}{
			"status":   models.CallStatusTimeout,
			"ended_at": now,
		}).Error
}

func expireStaleAcceptedCallsForUsers(db *gorm.DB, now time.Time, userIDs ...uint) ([]models.CallLog, error) {
	cutoff := now.Add(-ActiveCallHeartbeatTTL)
	var stale []models.CallLog
	ended := make([]models.CallLog, 0)

	err := db.Transaction(func(tx *gorm.DB) error {
		query := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("Caller", preloadPublicUser).
			Preload("Callee", preloadPublicUser).
			Where("status = ?", models.CallStatusAccepted).
			Where("updated_at < ?", cutoff)

		ids := uniqueNonZeroIDs(userIDs...)
		if len(ids) > 0 {
			query = query.Where("(caller_id IN ? OR callee_id IN ?)", ids, ids)
		}

		if err := query.Find(&stale).Error; err != nil {
			return err
		}

		for i := range stale {
			call := &stale[i]
			durationSeconds := callDurationSeconds(*call, now)
			result := tx.Model(&models.CallLog{}).
				Where("id = ? AND status = ?", call.ID, models.CallStatusAccepted).
				Where("updated_at < ?", cutoff).
				Updates(map[string]interface{}{
					"status":           models.CallStatusEnded,
					"ended_at":         now,
					"duration_seconds": durationSeconds,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				continue
			}
			call.Status = models.CallStatusEnded
			call.EndedAt = &now
			call.DurationSeconds = durationSeconds
			ended = append(ended, *call)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return ended, nil
}

func uniqueNonZeroIDs(userIDs ...uint) []uint {
	ids := make([]uint, 0, len(userIDs))
	seen := make(map[uint]struct{}, len(userIDs))
	for _, userID := range userIDs {
		if userID == 0 {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		ids = append(ids, userID)
	}
	return ids
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

func sameCallPair(call models.CallLog, userID1, userID2 uint) bool {
	return (call.CallerID == userID1 && call.CalleeID == userID2) ||
		(call.CallerID == userID2 && call.CalleeID == userID1)
}

func callExpired(call models.CallLog) bool {
	return call.ExpiresAt != nil && !call.ExpiresAt.After(time.Now())
}

func callDurationSeconds(call models.CallLog, endedAt time.Time) int {
	if call.AcceptedAt == nil {
		return 0
	}

	durationSeconds := int(endedAt.Sub(*call.AcceptedAt).Seconds())
	if durationSeconds < 0 {
		return 0
	}
	return durationSeconds
}
