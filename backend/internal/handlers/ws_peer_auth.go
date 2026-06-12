package handlers

import (
	"encoding/json"
	"log"

	"tester/internal/repository"
)

func authorizeRealtimePeerEvent(fromID uint, rawPayload json.RawMessage, eventType string) (uint, bool) {
	var payload struct {
		ToID uint `json:"to_id"`
	}

	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		log.Printf("Invalid %s payload: %v", eventType, err)
		return 0, false
	}

	if fromID == 0 || payload.ToID == 0 || payload.ToID == fromID {
		log.Printf("Rejected %s event with invalid peer: from_id=%d to_id=%d", eventType, fromID, payload.ToID)
		return 0, false
	}

	if dbInstance == nil {
		log.Printf("Rejected %s event: database is not initialized", eventType)
		return 0, false
	}

	status, err := repository.GetFriendshipStatus(dbInstance, fromID, payload.ToID)
	if err != nil {
		log.Printf("Failed to authorize %s event: from_id=%d to_id=%d error=%v", eventType, fromID, payload.ToID, err)
		return 0, false
	}

	// Blocked friendships are rejected by this status check. If blocking is later
	// moved out of friendships, add the explicit block lookup here.
	if status != "accepted" {
		log.Printf("Rejected %s event for non-accepted friendship: from_id=%d to_id=%d status=%s", eventType, fromID, payload.ToID, status)
		return 0, false
	}

	return payload.ToID, true
}
