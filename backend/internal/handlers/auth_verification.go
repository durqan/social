package handlers

import (
	"errors"

	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SendVerificationEmailHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		user, err := repository.GetUserById(db, userID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(401, gin.H{"error": "Unauthorized"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		if user.IsEmailVerified {
			c.JSON(200, gin.H{"message": "Email already verified"})
			return
		}

		if err := services.SendVerificationEmail(db, &user); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "Verification email sent successfully"})
	}
}

func VerifyEmailHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Param("token")
		if token == "" {
			c.JSON(400, gin.H{"error": "token is required"})
			return
		}

		if err := services.VerifyEmail(db, token); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}
		services.InvalidateEmailVerificationCaches()

		c.JSON(200, gin.H{"message": "Email successfully verified"})
	}
}
