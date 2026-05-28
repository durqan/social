package handlers

import (
	"errors"
	"tester/internal/dto"
	"tester/internal/repository"
	"tester/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

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
		id, ok := uintParam(c, "id", "invalid user id")
		if !ok {
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

		c.JSON(200, dto.ToUserResponse(user))
	}
}

func GetProfile(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		user, err := repository.GetUserById(db, userID)
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
		id, ok := requireOwnUser(c, "id", "can only delete your own account")
		if !ok {
			return
		}

		err := services.DeleteUserAccount(db, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "user not found"})
				return
			}
			c.JSON(500, gin.H{"error": "internal server error"})
			return
		}
		clearAuthSession(c)
		c.JSON(200, gin.H{"message": "user deleted"})
	}
}

func PatchUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := requireOwnUser(c, "id", "can only edit your own profile")
		if !ok {
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

		err := repository.UpdateUser(db, id, updates)
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

		user, err := repository.GetUserById(db, id)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to fetch updated user"})
			return
		}
		c.JSON(200, dto.ToUserResponse(user))
	}
}
