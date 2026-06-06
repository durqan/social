package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetE2EEStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		targetUserID := userID
		if rawTargetID := c.Query("user_id"); rawTargetID != "" {
			parsed, err := strconv.ParseUint(rawTargetID, 10, 32)
			if err != nil || parsed == 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
				return
			}
			targetUserID = uint(parsed)
		}

		if targetUserID != userID {
			status, err := repository.GetFriendshipStatus(db, userID, targetUserID)
			if err != nil {
				c.JSON(http.StatusForbidden, gin.H{"error": "can only read e2ee status for accepted friends"})
				return
			}
			if status != "accepted" {
				c.JSON(http.StatusForbidden, gin.H{"error": "can only read e2ee status for accepted friends"})
				return
			}
		}

		status, err := services.E2EEPublicStatusForUser(db, targetUserID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get e2ee status"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"enabled":    status.Enabled,
			"public_key": status.PublicKey,
		})
	}
}

func EnableE2EE(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		saveE2EEBackup(c, db, http.StatusCreated)
	}
}

func SaveE2EEBackup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		saveE2EEBackup(c, db, http.StatusOK)
	}
}

func GetE2EEBackup(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		backup, err := repository.GetEncryptedKeyBackupByUserID(db, userID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, gin.H{
				"enabled":              false,
				"encrypted_master_key": nil,
			})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get e2ee backup"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"enabled":              true,
			"encrypted_master_key": backup.EncryptedMasterKey,
		})
	}
}

func DisableE2EE(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		if err := services.DeleteEncryptedKeyBackup(db, userID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to disable e2ee"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"enabled": false})
	}
}

func saveE2EEBackup(c *gin.Context, db *gorm.DB, statusCode int) {
	userID, ok := authenticatedUserID(c)
	if !ok {
		return
	}

	var req struct {
		EncryptedMasterKey string `json:"encrypted_master_key" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err := services.SaveEncryptedKeyBackup(db, userID, req.EncryptedMasterKey)
	if errors.Is(err, services.ErrEncryptedKeyBackupInvalid) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid encrypted master key backup"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save e2ee backup"})
		return
	}

	c.JSON(statusCode, gin.H{"enabled": true})
}
