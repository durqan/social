package handlers

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"tester/internal/notifications"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func enqueueNotification(db *gorm.DB, recipientID, actorID uint, notificationType string, entityID uint) error {
	if recipientID == actorID {
		return nil
	}

	job := notifications.Job{
		Action:      notifications.ActionCreate,
		RecipientID: recipientID,
		ActorID:     actorID,
		Type:        notificationType,
		EntityID:    entityID,
	}

	if err := services.EnqueueNotificationOutbox(db, job); err != nil {
		log.Printf(
			"failed to enqueue notification outbox: recipient_id=%d actor_id=%d type=%s entity_id=%d error=%v",
			job.RecipientID,
			job.ActorID,
			job.Type,
			job.EntityID,
			err,
		)
		return err
	}
	return nil
}

func enqueueMessageReadSync(db *gorm.DB, readerID uint, conversationID uint) {
	if db == nil || readerID == 0 || conversationID == 0 {
		return
	}

	job := notifications.Job{
		Action:         notifications.ActionMarkConversationRead,
		RecipientID:    readerID,
		ActorID:        conversationID,
		Type:           notifications.TypeMessage,
		ConversationID: conversationID,
	}

	if err := services.EnqueueNotificationOutbox(db, job); err != nil {
		log.Printf(
			"failed to enqueue message read sync: reader_id=%d conversation_id=%d error=%v",
			readerID,
			conversationID,
			err,
		)
	}
}

// enqueueIncomingCallNotification creates a push-eligible notification after
// the backend has persisted a new ringing call.
// Outbox persistence errors are logged but MUST NOT roll back call creation.
// If callID is empty we still publish using conversationID fallback for tag/URL (dedup will be weaker).
// See detailed rationale in ws_events.go.
func enqueueIncomingCallNotification(db *gorm.DB, recipientID, actorID uint, callID string, conversationID uint, callType string) {
	if recipientID == actorID {
		return
	}

	if callID == "" {
		log.Printf(
			"warning: publishing incoming_call push without call_id (dedup may be weaker): caller_id=%d recipient_id=%d conversation_id=%d",
			actorID, recipientID, conversationID,
		)
	}

	job := notifications.Job{
		Action:         notifications.ActionCreate,
		RecipientID:    recipientID,
		ActorID:        actorID,
		Type:           notifications.TypeIncomingCall,
		EntityID:       0,
		CallID:         callID,
		ConversationID: conversationID,
		CallType:       callType,
	}

	if err := services.EnqueueNotificationOutbox(db, job); err != nil {
		log.Printf(
			"error: failed to enqueue incoming_call notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d type=incoming_call error=%v",
			job.CallID, job.ActorID, job.RecipientID, job.ConversationID, err,
		)
		return
	}

	log.Printf(
		"info: enqueued incoming_call notification: call_id=%s caller_id=%d recipient_id=%d conversation_id=%d",
		job.CallID, job.ActorID, job.RecipientID, job.ConversationID,
	)
}

func enqueueCallStateNotification(db *gorm.DB, recipientID, actorID uint, notificationType string, callID string, conversationID uint, callType string) {
	if db == nil || recipientID == 0 || actorID == 0 || recipientID == actorID || callID == "" {
		return
	}

	job := notifications.Job{
		Action:         notifications.ActionCreate,
		RecipientID:    recipientID,
		ActorID:        actorID,
		Type:           notificationType,
		EntityID:       0,
		CallID:         callID,
		ConversationID: conversationID,
		CallType:       callType,
	}

	if err := services.EnqueueNotificationOutbox(db, job); err != nil {
		log.Printf(
			"failed to enqueue call state notification: call_id=%s type=%s recipient_id=%d actor_id=%d error=%v",
			callID,
			notificationType,
			recipientID,
			actorID,
			err,
		)
	}
}

func GetNotifications(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		limit := 30
		if rawLimit := c.Query("limit"); rawLimit != "" {
			parsed, err := strconv.Atoi(rawLimit)
			if err != nil || parsed < 1 || parsed > 100 {
				jsonError(c, http.StatusBadRequest, "invalid limit")
				return
			}
			limit = parsed
		}
		page, err := service.GetPage(
			c.Request.Context(),
			userID,
			limit,
			c.Query("cursor"),
		)
		if errors.Is(err, notifications.ErrInvalidCursor) {
			jsonError(c, http.StatusBadRequest, "invalid cursor")
			return
		}
		if err != nil {
			log.Printf("failed to load notifications: user_id=%d error=%v", userID, err)
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		if page.NextCursor != "" {
			c.Header("X-Next-Cursor", page.NextCursor)
		}
		c.Header("X-Unseen-Count", strconv.FormatInt(page.UnseenCount, 10))
		c.JSON(http.StatusOK, page.Notifications)
	}
}

func MarkNotificationAsRead(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		notificationID, ok := uintParam(c, "id", "invalid id")
		if !ok {
			return
		}
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		if err := service.MarkAsRead(c.Request.Context(), notificationID, userID); err != nil {
			jsonError(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "OK"})
	}
}

func MarkNotificationsAsSeen(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request notifications.MarkSeenRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			jsonError(c, http.StatusBadRequest, err.Error())
			return
		}
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		if err := service.MarkAsSeen(c.Request.Context(), userID, request.IDs); err != nil {
			jsonError(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "OK"})
	}
}

func MarkMatchingNotificationsAsRead(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request notifications.MarkReadRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			jsonError(c, http.StatusBadRequest, err.Error())
			return
		}
		if len(request.Types) == 0 {
			jsonError(c, http.StatusBadRequest, "types are required")
			return
		}
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		if err := service.MarkMatchingAsRead(
			c.Request.Context(),
			userID,
			request,
		); err != nil {
			jsonError(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "OK"})
	}
}

func RegisterMobilePushToken(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request notifications.MobilePushTokenRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			jsonError(c, http.StatusBadRequest, "invalid mobile push token")
			return
		}
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		if err := service.SaveMobilePushToken(
			c.Request.Context(),
			userID,
			request,
		); err != nil {
			jsonError(c, http.StatusBadRequest, "invalid mobile push token")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "registered"})
	}
}

func RevokeMobilePushToken(service *notifications.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		var request notifications.MobilePushTokenRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			jsonError(c, http.StatusBadRequest, "invalid mobile push token")
			return
		}
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		if err := service.RevokeMobilePushToken(
			c.Request.Context(),
			userID,
			request,
		); err != nil {
			log.Printf("failed to revoke mobile push token: user_id=%d error=%v", userID, err)
			jsonError(c, http.StatusInternalServerError, "failed to revoke mobile push token")
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "revoked"})
	}
}
