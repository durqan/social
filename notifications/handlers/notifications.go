package handlers

import (
	"errors"
	"net/http"
	"notifications/auth"
	"notifications/dto"
	"notifications/services"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *services.Service
}

func NewHandler(service *services.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetUserNotifications(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	limit := 30
	if rawLimit := c.Query("limit"); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
			return
		}
		limit = parsed
	}
	page, err := h.service.GetUserNotificationsPage(userID, limit, c.Query("cursor"))
	if errors.Is(err, services.ErrInvalidNotificationCursor) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if page.NextCursor != "" {
		c.Header("X-Next-Cursor", page.NextCursor)
	}
	c.Header("X-Unseen-Count", strconv.FormatInt(page.UnseenCount, 10))
	c.JSON(http.StatusOK, page.Notifications)
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

func (h *Handler) MarkAsSeen(c *gin.Context) {
	req := dto.MarkNotificationsSeenReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	if err := h.service.MarkAsSeen(userID, req.IDs); err != nil {
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

	err := h.service.ProcessNotification(&req)
	if errors.Is(err, services.ErrInvalidNotificationRequest) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"status": "created"})
}

func (h *Handler) RegisterMobilePushToken(c *gin.Context) {
	req := dto.MobilePushTokenReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mobile push token"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}
	req.UserID = userID

	if err := h.service.SaveMobilePushToken(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mobile push token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "registered"})
}

func (h *Handler) RevokeMobilePushToken(c *gin.Context) {
	req := dto.MobilePushTokenReq{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid mobile push token"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		return
	}

	if err := h.service.RevokeMobilePushToken(userID, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke mobile push token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "revoked"})
}
