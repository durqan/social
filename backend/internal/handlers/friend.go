package handlers

import (
	"errors"
	"tester/internal/dto"
	"tester/internal/models"
	"tester/internal/repository"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SendFriendRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		friendID, ok := uintParam(c, "id", "invalid user id")
		if !ok {
			return
		}

		if currentUserID == friendID {
			c.JSON(400, gin.H{"error": "you cannot add yourself as a friend"})
			return
		}

		status, err := repository.GetFriendshipStatus(db, currentUserID, friendID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to check friendship status"})
			return
		}

		if status != "none" {
			c.JSON(409, gin.H{"error": "friend request already sent or you are already friends"})
			return
		}

		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := repository.SendFriendRequest(tx, currentUserID, friendID); err != nil {
				return err
			}
			return enqueueNotification(tx, friendID, currentUserID, dto.NotificationTypeFriendRequest, currentUserID)
		}); err != nil {
			c.JSON(500, gin.H{"error": "failed to send friend request"})
			return
		}

		notifyFriendEvent(db, friendID, currentUserID, "friend:request", "sent you a friend request")

		c.JSON(201, gin.H{"message": "friend request sent"})
	}
}

func GetFriendsList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		friends, err := repository.GetFriendsList(db, currentUserID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friends list"})
			return
		}

		c.JSON(200, dto.ToPublicUserResponses(friends))
	}
}

func GetFriendRequests(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}

		requests, err := repository.GetFriendRequests(db, currentUserID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friend requests"})
			return
		}

		c.JSON(200, friendRequestResponses(requests))
	}
}

type friendRequestResponse struct {
	ID        uint                   `json:"id"`
	UserID    uint                   `json:"user_id"`
	FriendID  uint                   `json:"friend_id"`
	Status    string                 `json:"status"`
	CreatedAt time.Time              `json:"created_at"`
	UpdatedAt time.Time              `json:"updated_at"`
	User      dto.PublicUserResponse `json:"user"`
	Friend    dto.PublicUserResponse `json:"friend"`
}

func friendRequestResponses(requests []models.Friendship) []friendRequestResponse {
	responses := make([]friendRequestResponse, 0, len(requests))
	for _, request := range requests {
		responses = append(responses, friendRequestResponse{
			ID:        request.ID,
			UserID:    request.UserID,
			FriendID:  request.FriendID,
			Status:    request.Status,
			CreatedAt: request.CreatedAt,
			UpdatedAt: request.UpdatedAt,
			User:      dto.ToPublicUserResponse(request.User),
			Friend:    dto.ToPublicUserResponse(request.Friend),
		})
	}
	return responses
}

func AcceptFriendRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		friendshipID, ok := uintParam(c, "id", "invalid friendship id")
		if !ok {
			return
		}

		var friendship models.Friendship
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := repository.AcceptFriendRequest(tx, friendshipID, currentUserID); err != nil {
				return err
			}
			if err := tx.First(&friendship, friendshipID).Error; err != nil {
				return err
			}
			return enqueueNotification(tx, friendship.UserID, currentUserID, dto.NotificationTypeFriendAccepted, friendship.ID)
		}); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(404, gin.H{"error": "friend request not found"})
				return
			}
			c.JSON(500, gin.H{"error": "failed to accept friend request"})
			return
		}

		notifyFriendEvent(db, friendship.UserID, currentUserID, "friend:accepted", "accepted your friend request")

		c.JSON(200, gin.H{"message": "friend request accepted"})
	}
}

func RemoveFriend(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		friendID, ok := uintParam(c, "id", "invalid friend id")
		if !ok {
			return
		}

		if err := repository.RemoveFriend(db, currentUserID, friendID); err != nil {
			c.JSON(500, gin.H{"error": "failed to remove friend"})
			return
		}

		c.JSON(200, gin.H{"message": "friend removed"})
	}
}

func BlockUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		friendID, ok := uintParam(c, "id", "invalid user id")
		if !ok {
			return
		}

		if err := repository.BlockUser(db, currentUserID, friendID); err != nil {
			c.JSON(500, gin.H{"error": "failed to block user"})
			return
		}

		c.JSON(200, gin.H{"message": "user blocked"})
	}
}

func GetFriendshipStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, ok := authenticatedUserID(c)
		if !ok {
			return
		}
		userID, ok := uintParam(c, "id", "invalid user id")
		if !ok {
			return
		}

		status, err := repository.GetFriendshipStatus(db, currentUserID, userID)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friendship status"})
			return
		}

		c.JSON(200, gin.H{"status": status})
	}
}
