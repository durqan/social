package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"os"
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

const (
	avatarMaxSize        = 5 << 20 // 5 MB
	avatarMaxRequestSize = avatarMaxSize + 1<<20
)

var allowedAvatarTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

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
		userID, exists := c.Get("user_id")
		if !exists {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}

		id, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		authUserID, ok := userID.(uint)
		if !ok {
			c.JSON(401, gin.H{"error": "invalid user"})
			return
		}

		if uint(id) != authUserID {
			c.JSON(403, gin.H{"error": "can only upload your own avatar"})
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, avatarMaxRequestSize)

		file, err := c.FormFile("avatar")
		if err != nil {
			c.JSON(400, gin.H{"error": "avatar is required"})
			return
		}

		if file.Size > avatarMaxSize {
			c.JSON(413, gin.H{"error": "avatar is too large"})
			return
		}

		src, err := file.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}
		defer src.Close()

		buf := make([]byte, 512)
		n, err := src.Read(buf)
		if err != nil && n == 0 {
			c.JSON(400, gin.H{"error": "failed to read avatar"})
			return
		}

		contentType := http.DetectContentType(buf[:n])
		ext, ok := allowedAvatarTypes[contentType]
		if !ok {
			c.JSON(415, gin.H{"error": "avatar must be jpeg, png or webp"})
			return
		}

		uploadDir := filepath.Join("uploads", "avatars")
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			c.JSON(500, gin.H{"error": "failed to prepare upload directory"})
			return
		}

		filename := fmt.Sprintf("%d_%d%s", id, time.Now().UnixNano(), ext)

		savePath := filepath.Join(
			uploadDir,
			filename,
		)

		if err := c.SaveUploadedFile(
			file,
			savePath,
		); err != nil {
			c.JSON(500, gin.H{"error": "failed to save avatar"})
			return
		}

		avatarURL := "/" + filepath.ToSlash(savePath)

		if err := repository.UpdateUserAvatar(
			db,
			uint(id),
			avatarURL,
		); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}

			c.JSON(500, gin.H{"error": "failed to update user"})
			return
		}

		c.JSON(200, gin.H{
			"avatar": avatarURL,
		})
	}
}
