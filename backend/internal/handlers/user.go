package handlers

import (
	"errors"
	"strconv"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func CreateUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name     string `json:"name" binding:"required"`
			Email    string `json:"email" binding:"required,email"`
			Password string `json:"password" binding:"required,min=6"`
			Age      int    `json:"age"`
			Bio      string `json:"bio"`
			Avatar   string `json:"avatar"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
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
			Age:      req.Age,
			Bio:      req.Bio,
			Avatar:   req.Avatar,
		}

		err = repository.CreateUser(db, &user)
		if err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				c.JSON(409, gin.H{"error": "email already exists"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		c.JSON(201, user)
	}
}

func GetUsers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		users, err := repository.GetAllUsers(db)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch users"})
			return
		}
		c.JSON(200, users)
	}
}

func GetUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		user, err := repository.GetUserById(db, uint(id))
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		c.JSON(200, user)
	}
}

func GetProfile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}

		user, err := repository.GetUserById(db, userID.(uint))
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		user.Password = ""
		c.JSON(200, user)
	}
}

func DeleteUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		id, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}
		if uint(id) != userID.(uint) {
			c.JSON(403, gin.H{"error": "can only delete your own account"})
			return
		}

		err = repository.DeleteUser(db, uint(id))
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}
		c.JSON(200, gin.H{"message": "user deleted"})
	}
}

func PatchUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		id, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}
		if uint(id) != userID.(uint) {
			c.JSON(403, gin.H{"error": "can only edit your own profile"})
			return
		}

		var req struct {
			Name   *string `json:"name"`
			Email  *string `json:"email" binding:"omitempty,email"`
			Age    *int    `json:"age"`
			Bio    *string `json:"bio"`
			Avatar *string `json:"avatar"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		updates := map[string]interface{}{}
		if req.Name != nil {
			updates["name"] = *req.Name
		}
		if req.Email != nil {
			updates["email"] = *req.Email
		}
		if req.Age != nil {
			updates["age"] = *req.Age
		}
		if req.Bio != nil {
			updates["bio"] = *req.Bio
		}
		if req.Avatar != nil {
			updates["avatar"] = *req.Avatar
		}
		if len(updates) == 0 {
			c.JSON(400, gin.H{"error": "no valid fields to update"})
			return
		}

		err = repository.UpdateUser(db, uint(id), updates)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				c.JSON(409, gin.H{"error": "email already exists"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}

		user, err := repository.GetUserById(db, uint(id))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch updated user"})
			return
		}
		user.Password = ""
		c.JSON(200, user)
	}
}

func ChangePassword(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _ := c.Get("user_id")
		id, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}
		if uint(id) != userID.(uint) {
			c.JSON(403, gin.H{"error": "can only change your own password"})
			return
		}

		var req struct {
			CurrentPassword string `json:"current_password" binding:"required"`
			NewPassword     string `json:"new_password" binding:"required,min=6"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		user, err := repository.GetUserById(db, uint(id))
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

		err = repository.ChangePassword(db, uint(id), string(hashedPassword))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to change password"})
			return
		}

		c.JSON(200, gin.H{"message": "password changed successfully"})
	}
}

func SearchUsersByNameOrEmail(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		if query == "" {
			c.JSON(400, gin.H{"error": "query parameter is required"})
			return
		}

		users, err := repository.GetUsersByEmailOrName(db, query)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to search users"})
			return
		}

		for i := range users {
			users[i].Password = ""
		}

		c.JSON(200, users)
	}
}
