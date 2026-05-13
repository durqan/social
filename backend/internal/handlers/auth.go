package handlers

import (
	"errors"
	"tester/internal/auth"
	"tester/internal/models"
	"tester/internal/repository"

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
			false,
			true,
		)

		user.Password = ""
		c.JSON(201, gin.H{
			"message": "registration successful",
			"user":    user,
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
			false,
			true,
		)

		user.Password = ""
		c.JSON(200, gin.H{
			"message": "login successful",
			"user":    user,
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
			false,
			true,
		)
		c.JSON(200, gin.H{"message": "logout successful"})
	}
}
