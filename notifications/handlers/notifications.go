package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
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
	userIDParam := c.Param("user_id")
	userID64, err := strconv.ParseUint(userIDParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	userNotifications, err := h.service.GetUserNotifications(uint(userID64))
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
	err = h.service.MarkAsRead(uint(noteID64))
	if err != nil {
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

	if err := h.service.SavePushSubscription(&req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "subscribed"})
}

func (h *Handler) StreamNotifications(c *gin.Context) {
	userIDParam := c.Param("user_id")
	userID64, err := strconv.ParseUint(userIDParam, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user_id"})
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming unsupported"})
		return
	}

	notifications, cleanup := h.hub.AddClient(uint(userID64))
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
