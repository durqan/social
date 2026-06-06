package handlers

import (
	"errors"

	"tester/internal/auth"
	"tester/internal/dto"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ChangePassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requireOwnUser(c, "id", "can only change your own password")
		if !ok {
			return
		}

		var req dto.ChangePasswordRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		err := services.ChangeUserPassword(db, id, req.CurrentPassword, req.NewPassword, req.EncryptedMasterKey)
		if errors.Is(err, services.ErrCurrentPassword) {
			c.JSON(401, gin.H{"error": "incorrect current password"})
			return
		}
		if errors.Is(err, services.ErrEncryptedKeyBackupInvalid) {
			c.JSON(400, gin.H{"error": "invalid encrypted master key backup"})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(404, gin.H{"error": "user not found"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to change password"})
			return
		}

		if sessionID, ok := c.Get("session_id"); ok {
			if currentSessionID, ok := sessionID.(string); ok {
				_ = auth.RevokeUserSessionsExcept(id, currentSessionID)
			}
		}

		c.JSON(200, gin.H{"message": "password changed successfully"})
	}
}
