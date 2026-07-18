package handlers

import (
	"errors"

	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ImportMessageLinkPreviewVideo(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		messageID, ok := uintParam(c, "messageId", "invalid message id")
		if !ok {
			return
		}

		message, err := services.RequestVideoImport(db, userID, messageID)
		if errors.Is(err, services.ErrVideoImportForbidden) {
			c.JSON(403, gin.H{"error": "you do not have access to this message"})
			return
		}
		if errors.Is(err, services.ErrVideoImportPreviewNotFound) {
			c.JSON(404, gin.H{"error": "link preview not found"})
			return
		}
		if errors.Is(err, services.ErrVideoImportUnsupported) {
			c.JSON(400, gin.H{"error": "unsupported video provider"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to start video import"})
			return
		}

		BroadcastMessageUpdate(c.Request.Context(), message)
		c.JSON(200, services.WithPrivateAttachmentURLs(message))
	}
}
