package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tester/internal/cache"
	"tester/internal/models"

	"gorm.io/gorm"
)

const UserActivityThrottle = 45 * time.Second

var activityFallback = struct {
	mu      sync.Mutex
	updates map[uint]time.Time
}{
	updates: make(map[uint]time.Time),
}

func MarkUserActivity(db *gorm.DB, userID uint) (*time.Time, error) {
	return markUserActivity(db, userID, false)
}

func ForceUserActivity(db *gorm.DB, userID uint) (*time.Time, error) {
	return markUserActivity(db, userID, true)
}

func markUserActivity(db *gorm.DB, userID uint, force bool) (*time.Time, error) {
	if db == nil || userID == 0 {
		return nil, nil
	}

	now := time.Now().UTC()
	if !force && !allowUserActivityUpdate(userID, now) {
		return nil, nil
	}

	if err := db.Model(&models.User{}).
		Where("id = ?", userID).
		Update("last_seen_at", now).
		Error; err != nil {
		return nil, err
	}

	if force {
		rememberUserActivityUpdate(userID, now)
	}

	return &now, nil
}

func allowUserActivityUpdate(userID uint, now time.Time) bool {
	if cache.Redis != nil {
		ok, err := cache.Redis.Client.SetNX(
			cache.Redis.Ctx,
			userActivityThrottleKey(userID),
			now.Format(time.RFC3339Nano),
			UserActivityThrottle,
		).Result()
		if err == nil {
			return ok
		}
	}

	activityFallback.mu.Lock()
	defer activityFallback.mu.Unlock()

	lastUpdate := activityFallback.updates[userID]
	if !lastUpdate.IsZero() && now.Sub(lastUpdate) < UserActivityThrottle {
		return false
	}

	activityFallback.updates[userID] = now
	return true
}

func rememberUserActivityUpdate(userID uint, now time.Time) {
	if cache.Redis != nil {
		_ = cache.Redis.Client.Set(
			context.Background(),
			userActivityThrottleKey(userID),
			now.Format(time.RFC3339Nano),
			UserActivityThrottle,
		).Err()
	}

	activityFallback.mu.Lock()
	activityFallback.updates[userID] = now
	activityFallback.mu.Unlock()
}

func userActivityThrottleKey(userID uint) string {
	return fmt.Sprintf("presence:last_seen_throttle:%d", userID)
}
