package handlers

import (
	"errors"
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

		token, err := startAuthSession(c, user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(201, gin.H{
			"message": "registration successful",
			"token":   token,
			"user":    dto.ToUserResponse(user),
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

		token, err := startAuthSession(c, user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{
			"message": "login successful",
			"token":   token,
			"user":    dto.ToUserResponse(user),
		})
	}
}

func Logout() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := currentAuthToken(c)
		if token != "" {
			_ = auth.RevokeToken(token)
		}
		clearAuthSession(c)
		c.JSON(200, gin.H{"message": "logout successful"})
	}
}
