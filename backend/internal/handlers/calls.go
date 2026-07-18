package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	livekitservice "tester/internal/livekit"
	"tester/internal/models"
	"tester/internal/notifications"
	"tester/internal/repository"
	"tester/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type callUserResponse struct {
	ID     uint   `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type callResponse struct {
	CallID         string           `json:"call_id"`
	ConversationID *uint            `json:"conversation_id,omitempty"`
	CallerID       uint             `json:"caller_id"`
	CalleeID       uint             `json:"callee_id"`
	CallType       string           `json:"call_type"`
	Status         string           `json:"status"`
	StartedAt      time.Time        `json:"started_at"`
	ExpiresAt      *time.Time       `json:"expires_at,omitempty"`
	AcceptedAt     *time.Time       `json:"accepted_at,omitempty"`
	EndedAt        *time.Time       `json:"ended_at,omitempty"`
	Duration       int              `json:"duration_seconds"`
	CreatedAt      time.Time        `json:"created_at"`
	Caller         callUserResponse `json:"caller"`
	Callee         callUserResponse `json:"callee"`
}

type createCallRequest struct {
	ToID     uint   `json:"to_id"`
	CallType string `json:"call_type"`
}

func CreateCall(database *gorm.DB, liveKit *livekitservice.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		var request createCallRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			jsonError(c, http.StatusBadRequest, "invalid call request")
			return
		}
		request.CallType = strings.ToLower(strings.TrimSpace(request.CallType))
		if request.ToID == 0 || request.ToID == userID ||
			(request.CallType != models.CallTypeAudio && request.CallType != models.CallTypeVideo) {
			jsonError(c, http.StatusBadRequest, "invalid call request")
			return
		}

		friendshipStatus, err := repository.GetFriendshipStatus(database, userID, request.ToID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to authorize call")
			return
		}
		if friendshipStatus != "accepted" {
			jsonError(c, http.StatusForbidden, "calls require an accepted friendship")
			return
		}

		randomID, err := utils.GenerateSecureToken()
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create call")
			return
		}
		callID := "call-" + randomID
		conversationID := userID
		call, replaced, _, err := repository.CreateCall(
			database,
			userID,
			request.ToID,
			callID,
			request.CallType,
			&conversationID,
		)
		if errors.Is(err, repository.ErrCallBusy) {
			sendCallStateEvent(c.Request.Context(), "call:busy", request.ToID, callID, userID)
			jsonError(c, http.StatusConflict, "participant is busy")
			return
		}
		if err != nil {
			jsonError(c, http.StatusConflict, "call could not be created")
			return
		}

		for _, previous := range replaced {
			sendCallStateEvent(c.Request.Context(), "call:replaced", userID, previous.CallID, previous.CallerID, previous.CalleeID)
			enqueueCallStateNotification(database, previous.CalleeID, previous.CallerID, notifications.TypeCallEnded, previous.CallID, conversationIDForCall(previous), previous.CallType)
			closeLiveKitRoom(c.Request.Context(), liveKit, previous.CallID)
		}

		sendCallStateEvent(c.Request.Context(), "call:incoming", userID, call.CallID, request.ToID)
		enqueueIncomingCallNotification(
			database,
			request.ToID,
			userID,
			call.CallID,
			conversationIDForCall(*call),
			call.CallType,
		)

		loaded, loadErr := repository.FindCallForParticipant(database, userID, call.CallID)
		if loadErr == nil {
			*call = loaded
		}
		c.JSON(http.StatusCreated, gin.H{"call": callToResponse(*call)})
	}
}

func GetCall(database *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		emitExpiredCallTimeouts(c.Request.Context(), database)

		call, err := repository.FindCallForParticipant(database, userID, strings.TrimSpace(c.Param("callId")))
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
			logActiveCallRestore(userID, call)
			c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
			return
		}

		call, err := repository.FindActiveCallForUser(database, userID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{"call": nil})
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get active call")
			return
		}

		logActiveCallRestore(userID, call)
		c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
	}
}

func AcceptCall(database *gorm.DB) gin.HandlerFunc {
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
		if call.CalleeID != userID {
			jsonError(c, http.StatusForbidden, "only callee can accept call")
			return
		}
		if call.Status == models.CallStatusAccepted {
			c.JSON(http.StatusOK, gin.H{"call": callToResponse(call)})
			return
		}

		transition, changed, err := repository.MarkCallAccepted(database, userID, call.CallerID, callID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to accept call")
			return
		}
		if !changed {
			jsonError(c, http.StatusGone, "call is no longer active")
			return
		}
		sendCallStateEvent(c.Request.Context(), "call:accepted", userID, transition.CallID, transition.CallerID, transition.CalleeID)

		loaded, loadErr := repository.FindCallForParticipant(database, userID, callID)
		if loadErr == nil {
			transition = loaded
		}
		c.JSON(http.StatusOK, gin.H{"call": callToResponse(transition)})
	}
}

func RejectCall(database *gorm.DB, liveKit *livekitservice.Service) gin.HandlerFunc {
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

		transition, changed, err := repository.MarkCallRejected(database, userID, call.CallerID, callID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to reject call")
			return
		}
		if changed {
			sendCallStateEvent(c.Request.Context(), "call:reject", userID, transition.CallID, transition.CallerID, transition.CalleeID)
			enqueueCallStateNotification(database, transition.CallerID, userID, notifications.TypeCallRejected, transition.CallID, conversationIDForCall(transition), transition.CallType)
			closeLiveKitRoom(c.Request.Context(), liveKit, transition.CallID)
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func EndCall(database *gorm.DB, liveKit *livekitservice.Service) gin.HandlerFunc {
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

		transition, changed, err := repository.MarkCallEnded(database, userID, peerID, callID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to end call")
			return
		}
		if changed {
			sendCallStateEvent(c.Request.Context(), "call:end", userID, transition.CallID, transition.CallerID, transition.CalleeID)
			enqueueCallStateNotification(database, peerID, userID, notifications.TypeCallEnded, transition.CallID, conversationIDForCall(transition), transition.CallType)
			closeLiveKitRoom(c.Request.Context(), liveKit, transition.CallID)
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func GetLiveKitToken(database *gorm.DB, liveKit *livekitservice.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		sessionValue, ok := c.Get("session_id")
		sessionID, validSession := sessionValue.(string)
		if !ok || !validSession || strings.TrimSpace(sessionID) == "" {
			jsonError(c, http.StatusUnauthorized, "authenticated session is required")
			return
		}

		call, err := repository.FindCallByID(database, strings.TrimSpace(c.Param("callId")))
		if errors.Is(err, gorm.ErrRecordNotFound) {
			jsonError(c, http.StatusNotFound, "call not found")
			return
		}
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to get call")
			return
		}
		if call.CallerID != userID && call.CalleeID != userID {
			jsonError(c, http.StatusForbidden, "call access denied")
			return
		}
		if call.Status != models.CallStatusAccepted {
			jsonError(c, http.StatusGone, "call is no longer joinable")
			return
		}

		credentials, err := liveKit.CreateJoinCredentials(call, userID, sessionID)
		if err != nil {
			jsonError(c, http.StatusInternalServerError, "failed to create media credentials")
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{
			"server_url": credentials.ServerURL,
			"token":      credentials.Token,
		})
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

func closeLiveKitRoom(parent context.Context, liveKit *livekitservice.Service, callID string) {
	if liveKit == nil || strings.TrimSpace(callID) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()
	if err := liveKit.CloseRoom(ctx, callID); err != nil {
		log.Printf("failed to close LiveKit room: call_id=%s error=%v", callID, err)
	}
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
	return callResponse{
		CallID:         call.CallID,
		ConversationID: call.ConversationID,
		CallerID:       call.CallerID,
		CalleeID:       call.CalleeID,
		CallType:       call.CallType,
		Status:         call.Status,
		StartedAt:      call.StartedAt,
		ExpiresAt:      call.ExpiresAt,
		AcceptedAt:     call.AcceptedAt,
		EndedAt:        call.EndedAt,
		Duration:       call.DurationSeconds,
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
}

func logActiveCallRestore(userID uint, call models.CallLog) {
	log.Printf(
		"active call restore: user_id=%d call_id=%s status=%s media=livekit",
		userID,
		call.CallID,
		call.Status,
	)
}
