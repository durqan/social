package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type callUserResponse struct {
	ID     uint   `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type callResponse struct {
	CallID         string            `json:"call_id"`
	ConversationID *uint             `json:"conversation_id,omitempty"`
	CallerID       uint              `json:"caller_id"`
	CalleeID       uint              `json:"callee_id"`
	CallType       string            `json:"call_type"`
	Status         string            `json:"status"`
	StartedAt      time.Time         `json:"started_at"`
	ExpiresAt      *time.Time        `json:"expires_at,omitempty"`
	AnsweredAt     *time.Time        `json:"answered_at,omitempty"`
	EndedAt        *time.Time        `json:"ended_at,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	Caller         callUserResponse  `json:"caller"`
	Callee         callUserResponse  `json:"callee"`
	Offer          json.RawMessage   `json:"offer,omitempty"`
	IceCandidates  []json.RawMessage `json:"ice_candidates,omitempty"`
}

func GetCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Param("callId"))
		call, err := repository.FindCallForParticipant(database, userID, callID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			jsonError(c, http.StatusNotFound, "call not found")
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call")
			return
		}

		c.JSON(http.StatusOK, callToResponse(call))
	}
}

func GetActiveCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Query("call_id"))
		if callID != "" {
			call, err := repository.FindCallForParticipant(database, userID, callID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusOK, gin.H{"call": nil})
				return
			}
			if err != nil {
				jsonError(c, http.StatusInternalServerError, "failed to get call")
				return
			}
			c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
			return
		}

		call, err := repository.FindActiveRingingCallForCallee(database, userID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"call": nil})
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get active call")
			return
		}

		c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
	}
}

func DebugCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Param("callId"))
		call, err := repository.DebugCallDump(database, userID, callID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			jsonError(c, http.StatusNotFound, "call not found")
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call debug dump")
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"call_id":          call.CallID,
			"conversation_id":  call.ConversationID,
			"caller_id":        call.CallerID,
			"callee_id":        call.CalleeID,
			"call_type":        call.CallType,
			"status":           call.Status,
			"started_at":       call.StartedAt,
			"expires_at":       call.ExpiresAt,
			"answered_at":      call.AnsweredAt,
			"ended_at":         call.EndedAt,
			"duration_seconds": call.DurationSeconds,
			"updated_at":       call.UpdatedAt,
		})
	}
}

func RejectCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Param("callId"))
		call, err := repository.FindCallForParticipant(database, userID, callID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call")
			return
		}
		if call.CalleeID != userID {
			jsonError(c, http.StatusForbidden, "only callee can reject call")
			return
		}

		transitionCall, shouldForward, err := repository.MarkCallDeclined(database, userID, call.CallerID, callID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to reject call")
			return
		}
		if shouldForward {
			sendCallStateEvent(c.Request.Context(), "call:reject", userID, transitionCall.CallID, transitionCall.CallerID, transitionCall.CalleeID)
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func EndCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Param("callId"))
		call, err := repository.FindCallForParticipant(database, userID, callID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"ok": true})
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call")
			return
		}
		peerID := call.CalleeID
		if userID == call.CalleeID {
			peerID = call.CallerID
		}

		transitionCall, shouldForward, err := repository.MarkCallEnded(database, userID, peerID, callID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to end call")
			return
		}
		if shouldForward {
			sendCallStateEvent(c.Request.Context(), "call:end", userID, transitionCall.CallID, transitionCall.CallerID, transitionCall.CalleeID)
			enqueueCallStateNotification(database, peerID, userID, dto.NotificationTypeCallEnded, transitionCall.CallID, conversationIDForCall(transitionCall), transitionCall.CallType)
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func AcceptCallIntent(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		callID := strings.TrimSpace(c.Param("callId"))
		call, err := repository.FindCallForParticipant(database, userID, callID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			jsonError(c, http.StatusGone, "call is no longer active")
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call")
			return
		}
		if call.CalleeID != userID || call.Status != models.CallStatusRinging || (call.ExpiresAt != nil && !call.ExpiresAt.After(time.Now())) {
			jsonError(c, http.StatusGone, "call is no longer active")
			return
		}

		c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
	}
}

func sendCallStateEvent(ctx context.Context, eventType string, fromID uint, callID string, participantIDs ...uint) {
	eventBytes, err := json.Marshal(gin.H{
		"type": eventType,
		"payload": gin.H{
			"from_id": fromID,
			"call_id": callID,
		},
	})
	if err != nil {
		return
	}
	writeToUsers(ctx, eventBytes, participantIDs...)
}

func conversationIDForCall(call models.CallLog) uint {
	if call.ConversationID != nil && *call.ConversationID != 0 {
		return *call.ConversationID
	}
	if call.CallerID != 0 {
		return call.CallerID
	}
	return call.CalleeID
}

func callToResponse(call models.CallLog) callResponse {
	response := callResponse{
		CallID:         call.CallID,
		ConversationID: call.ConversationID,
		CallerID:       call.CallerID,
		CalleeID:       call.CalleeID,
		CallType:       call.CallType,
		Status:         call.Status,
		StartedAt:      call.StartedAt,
		ExpiresAt:      call.ExpiresAt,
		AnsweredAt:     call.AnsweredAt,
		EndedAt:        call.EndedAt,
		CreatedAt:      call.CreatedAt,
		Caller: callUserResponse{
			ID:     call.Caller.ID,
			Name:   call.Caller.Name,
			Avatar: call.Caller.Avatar,
		},
		Callee: callUserResponse{
			ID:     call.Callee.ID,
			Name:   call.Callee.Name,
			Avatar: call.Callee.Avatar,
		},
	}

	if call.OfferPayload != "" && json.Valid([]byte(call.OfferPayload)) {
		response.Offer = json.RawMessage(call.OfferPayload)
	}
	if call.IceCandidates != "" {
		var candidates []json.RawMessage
		if err := json.Unmarshal([]byte(call.IceCandidates), &candidates); err == nil {
			response.IceCandidates = candidates
		}
	}

	return response
}
