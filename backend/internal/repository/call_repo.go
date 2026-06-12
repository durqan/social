package repository

import (
	"errors"
	"strings"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

func NormalizeCallType(callType string) string {
	if strings.EqualFold(strings.TrimSpace(callType), models.CallTypeVideo) {
		return models.CallTypeVideo
	}
	return models.CallTypeAudio
}

func CreateCallOffer(db *gorm.DB, callerID, calleeID uint, callID string, callType string, conversationID *uint) (*models.CallLog, error) {
	if callerID == 0 || calleeID == 0 || callerID == calleeID || strings.TrimSpace(callID) == "" {
		return nil, gorm.ErrRecordNotFound
	}

	now := time.Now()
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
			StartedAt:      now,
		}
		return tx.Create(&call).Error
	})
	if err != nil {
		return nil, err
	}
	return &call, nil
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
