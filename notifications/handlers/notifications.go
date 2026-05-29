package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"notifications/auth"
	"notifications/dto"
	"notifications/hub"
	"notifications/services"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *services.Service
	hub     *hub.Hub
}

func NewHandler(service *services.Service, hub *hub.Hub) *Handler {
	return &Handler{service: service, hub: hub}
}

func (h *Handler) GetUserNotifications(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	userNotifications, err := h.service.GetUserNotifications(userID)
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, userNotifications)
	return
}

func (h *Handler) MarkAsRead(c *gin.Context) {
	noteIDParam := c.Param("id")
	noteID64, err := strconv.ParseUint(noteIDParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	err = h.service.MarkAsRead(uint(noteID64), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "OK"})
}

func (h *Handler) MarkMatchingAsRead(c *gin.Context) {
	req := dto.MarkNotificationsReadReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Types) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "types are required"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	if err := h.service.MarkMatchingAsRead(userID, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "OK"})
}

func (h *Handler) CreateNotification(c *gin.Context) {
	req := dto.CreateNotificationReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := h.service.CreateNotification(&req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "created"})
}

func (h *Handler) SubscribePush(c *gin.Context) {
	req := dto.PushSubscriptionReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}
	req.UserID = userID

	if err := h.service.SavePushSubscription(&req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "subscribed"})
}

func (h *Handler) StreamNotifications(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	notifications, cleanup := h.hub.AddClient(userID)
	defer cleanup()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Status(http.StatusOK)
	flusher.Flush()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case notification := <-notifications:
			data, err := json.Marshal(notification)
			if err != nil {
				continue
			}

			if _, err := fmt.Fprintf(c.Writer, "data: %s\n\n", data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
