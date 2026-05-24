package handlers

import (
	"errors"

	"tester/internal/auth"
	"tester/internal/dto"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
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

		user, err := repository.GetUserById(db, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)); err != nil {
			c.JSON(401, gin.H{"error": "incorrect current password"})
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to hash password"})
			return
		}

		if err := repository.ChangePassword(db, id, string(hashedPassword)); err != nil {
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
