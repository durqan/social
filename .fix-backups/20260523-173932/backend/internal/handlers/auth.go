package handlers

import (
	"errors"
	"net/http"
	"tester/internal/auth"
	"tester/internal/config"
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func Register(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.RegisterRequest

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		_, err := repository.GetUserByEmail(db, req.Email)
		if err == nil {
			c.JSON(409, gin.H{"error": "user with this email already exists"})
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to hash password"})
			return
		}

		user := models.User{
			Name:     req.Name,
			Email:    req.Email,
			Password: string(hashedPassword),
		}

		if err := repository.CreateUser(db, &user); err != nil {
			c.JSON(500, gin.H{"error": "failed to create user"})
			return
		}

		token, err := auth.GenerateToken(user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to generate token"})
			return
		}

		c.SetCookie(
			"token",
			token,
			86400,
			"/",
			"",
			secureCookie(),
			true,
		)

		c.JSON(201, gin.H{
			"message": "registration successful",
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

		user, err := repository.GetUserByEmail(db, req.Email)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(401, gin.H{"error": "invalid email or password"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
			c.JSON(401, gin.H{"error": "invalid email or password"})
			return
		}

		token, err := auth.GenerateToken(user.ID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to generate token"})
			return
		}

		c.SetCookie(
			"token",
			token,
			86400,
			"/",
			"",
			secureCookie(),
			true,
		)

		c.JSON(200, gin.H{
			"message": "login successful",
			"user":    dto.ToUserResponse(user),
		})
	}
}

func Logout() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.SetCookie(
			"token",
			"",
			-1,
			"/",
			"",
			secureCookie(),
			true,
		)
		c.JSON(200, gin.H{"message": "logout successful"})
	}
}

func secureCookie() bool {
	return config.Load().CookieSecure
}

func SendVerificationEmailHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userIDValue, exists := c.Get("user_id")
		if !exists {
			c.JSON(401, gin.H{"error": "Unauthorized"})
			return
		}

		userID, ok := userIDValue.(uint)
		if !ok {
			c.JSON(401, gin.H{"error": "Unauthorized"})
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

		c.JSON(200, gin.H{
			"message": "Verification email sent successfully",
		})
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

		c.JSON(200, gin.H{
			"message": "Email successfully verified",
		})
	}
}
