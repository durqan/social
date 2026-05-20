package handlers

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func CreateUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req dto.CreateUserRequest

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

		c.JSON(201, dto.ToUserResponse(user))
	}
}

func GetUsers(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		users, err := repository.GetAllUsers(db)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch users"})
			return
		}
		c.JSON(200, dto.ToUserResponses(users))
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

		c.JSON(200, dto.ToUserResponse(user))
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

		c.JSON(200, dto.ToUserResponse(user))
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

		var req dto.UpdateUserRequest
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
		c.JSON(200, dto.ToUserResponse(user))
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

		var req dto.ChangePasswordRequest

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

		c.JSON(200, dto.ToUserResponses(users))
	}
}

func UploadAvatar(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		idParam := c.Param("id")
		id, err := strconv.Atoi(idParam)
		if err != nil {
			c.JSON(400, gin.H{
				"error": "invalid user id",
			})
			return
		}

		file, err := c.FormFile("avatar")
		if err != nil {
			c.JSON(400, gin.H{
				"error": "avatar is required",
			})
			return
		}

		ext := filepath.Ext(
			file.Filename,
		)

		filename := fmt.Sprintf("%d_%d%s", id, time.Now().Unix(), ext)

		savePath := filepath.Join(
			"uploads",
			"avatars",
			filename,
		)

		if err := c.SaveUploadedFile(
			file,
			savePath,
		); err != nil {
			c.JSON(500, gin.H{
				"error": "failed to save avatar",
			})
			return
		}

		avatarURL := "/" + savePath

		if err := repository.UpdateUserAvatar(
			db,
			uint(id),
			avatarURL,
		); err != nil {
			c.JSON(500, gin.H{
				"error": "failed to update user",
			})
			return
		}
		c.JSON(200, gin.H{
			"avatar": avatarURL,
		})
	}
}
