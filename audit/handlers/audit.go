package handlers

import (
	"audit/models"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AuditHandler struct {
	db *gorm.DB
}

func NewAuditHandler(db *gorm.DB) *AuditHandler {
	return &AuditHandler{db: db}
}

func (h *AuditHandler) CreateAuditEvent(c *gin.Context) {
	var event models.AuditEvent

	if err := c.ShouldBindJSON(&event); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	event.IP = c.ClientIP()
	event.UserAgent = c.GetHeader("User-Agent")

	if err := h.db.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create audit event"})
		return
	}

	c.JSON(http.StatusCreated, event)
}

func (h *AuditHandler) GetAuditEvents(c *gin.Context) {
	var events []models.AuditEvent

	if err := h.db.
		Order("created_at DESC").
		Limit(50).
		Find(&events).Error; err != nil {
		c.JSON(500, gin.H{"error": "failed to get audit events"})
		return
	}

	c.JSON(200, events)
}
