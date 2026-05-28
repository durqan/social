package middleware

import (
	"errors"
	"net/http"

	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const EmailVerificationRequiredMessage = "Подтвердите email, чтобы продолжить"

func RequireVerifiedEmail(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := userIDFromContext(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
			c.Abort()
			return
		}

		user, err := repository.GetUserById(db, userID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
				c.Abort()
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			c.Abort()
			return
		}

		if !user.IsEmailVerified {
			c.JSON(http.StatusForbidden, gin.H{"error": EmailVerificationRequiredMessage})
			c.Abort()
			return
		}

		c.Next()
	}
}

func userIDFromContext(c *gin.Context) (uint, bool) {
	value, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}

	switch id := value.(type) {
	case uint:
		return id, id > 0
	case int:
		return uint(id), id > 0
	case uint64:
		return uint(id), id > 0
	default:
		return 0, false
	}
}
