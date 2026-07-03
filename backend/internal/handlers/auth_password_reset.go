package handlers

import (
	"errors"
	"log"

	"tester/internal/auth"
	"tester/internal/models"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func ForgotPassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.ForgotPasswordRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		if err := services.RequestPasswordReset(db, req.Email); err != nil {
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		c.JSON(200, gin.H{"message": services.ForgotPasswordSuccessMessage})
	}
}

func ResetPassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.ResetPasswordRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		userID, err := services.ResetPassword(db, req.Token, req.Password)
		if errors.Is(err, services.ErrInvalidPasswordResetToken) {
			c.JSON(400, gin.H{"error": "invalid or expired reset token"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		if err := auth.RevokeUserSessions(userID); err != nil {
			log.Println("failed to revoke user sessions after password reset:", err)
		}

		c.JSON(200, gin.H{"message": "Пароль успешно обновлён"})
	}
}
