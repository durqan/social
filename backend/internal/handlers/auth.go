package handlers

import (
	"errors"
	"log"
	"tester/internal/auth"
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func Register(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.RegisterRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		user, err := services.RegisterUser(db, services.RegisterUserInput{
			Name:     req.Name,
			Email:    req.Email,
			Password: req.Password,
			Website:  req.Website,
		})
		if errors.Is(err, services.ErrRegistrationRejected) {
			c.JSON(400, gin.H{"error": "registration failed"})
			return
		}
		if errors.Is(err, services.ErrEmailAlreadyExists) {
			c.JSON(409, gin.H{"error": "user with this email already exists"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		_, err = startAuthSession(c, user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		if lastSeenAt, err := services.ForceUserActivity(db, user.ID); err != nil {
			log.Println("failed to update user activity:", err)
		} else if lastSeenAt != nil {
			user.LastSeenAt = lastSeenAt
		}

		c.JSON(201, gin.H{
			"message": "registration successful",
			"user":    dto.ToPrivateUserResponse(user),
		})
	}
}

func Login(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.LoginRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		user, err := services.AuthenticateUser(db, req.Email, req.Password)
		if errors.Is(err, services.ErrInvalidCredentials) {
			c.JSON(401, gin.H{"error": "invalid email or password"})
			return
		}
		if err != nil {
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		_, err = startAuthSession(c, user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		if lastSeenAt, err := services.ForceUserActivity(db, user.ID); err != nil {
			log.Println("failed to update user activity:", err)
		} else if lastSeenAt != nil {
			user.LastSeenAt = lastSeenAt
		}

		c.JSON(200, gin.H{
			"message": "login successful",
			"user":    dto.ToPrivateUserResponse(user),
		})
	}
}

func Refresh(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		refreshToken := currentRefreshToken(c)
		if refreshToken == "" {
			c.JSON(401, gin.H{"error": "refresh token required"})
			return
		}

		accessToken, userID, _, err := auth.RefreshAccessToken(refreshToken)
		if err != nil {
			clearAuthSession(c)
			c.JSON(401, gin.H{"error": "invalid or expired refresh token"})
			return
		}
		if _, err := services.MarkUserActivity(db, userID); err != nil {
			log.Println("failed to update user activity:", err)
		}

		setAuthCookie(c, accessToken, int(auth.AccessTokenTTL.Seconds()))
		if _, err := refreshCSRFCookie(c); err != nil {
			c.JSON(500, gin.H{"error": "failed to create csrf token"})
			return
		}

		c.JSON(200, gin.H{"message": "refresh successful"})
	}
}

func Logout(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := currentAuthToken(c)
		if token != "" {
			if userID, _, err := auth.ValidateToken(token); err == nil {
				if _, err := services.ForceUserActivity(db, userID); err != nil {
					log.Println("failed to update user activity:", err)
				}
			}
			_ = auth.RevokeToken(token)
		}
		refreshToken := currentRefreshToken(c)
		if refreshToken != "" {
			_ = auth.RevokeRefreshToken(refreshToken)
		}
		clearAuthSession(c)
		c.JSON(200, gin.H{"message": "logout successful"})
	}
}
