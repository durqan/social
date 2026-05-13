package handlers

import (
	"context"
	"encoding/json"
	"strconv"
	"tester/internal/models"
	"tester/internal/repository"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SendFriendRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")
		friendID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		if currentUserID.(uint) == uint(friendID) {
			c.JSON(400, gin.H{"error": "you cannot add yourself as a friend"})
			return
		}

		status, err := repository.GetFriendshipStatus(db, currentUserID.(uint), uint(friendID))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to check friendship status"})
			return
		}

		if status != "none" {
			c.JSON(409, gin.H{"error": "friend request already sent or you are already friends"})
			return
		}

		if err := repository.SendFriendRequest(db, currentUserID.(uint), uint(friendID)); err != nil {
			c.JSON(500, gin.H{"error": "failed to send friend request"})
			return
		}

		if toConn, ok := Clients[uint(friendID)]; ok {
			var sender models.User
			db.First(&sender, currentUserID.(uint))

			notification := map[string]interface{}{
				"type":      "friend_request",
				"from_id":   currentUserID.(uint),
				"from_name": sender.Name,
				"message":   "sent you a friend request",
			}
			notificationBytes, _ := json.Marshal(notification)
			toConn.Write(context.Background(), websocket.MessageText, notificationBytes)
		}

		c.JSON(201, gin.H{"message": "friend request sent"})
	}
}

func GetFriendsList(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")

		friends, err := repository.GetFriendsList(db, currentUserID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friends list"})
			return
		}

		c.JSON(200, friends)
	}
}

func GetFriendRequests(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")

		requests, err := repository.GetFriendRequests(db, currentUserID.(uint))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friend requests"})
			return
		}

		c.JSON(200, requests)
	}
}

func AcceptFriendRequest(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")
		friendshipID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid friendship id"})
			return
		}

		if err := repository.AcceptFriendRequest(db, uint(friendshipID), currentUserID.(uint)); err != nil {
			c.JSON(500, gin.H{"error": "failed to accept friend request"})
			return
		}

		var friendship models.Friendship
		db.First(&friendship, friendshipID)

		if toConn, ok := Clients[friendship.UserID]; ok {
			var currentUser models.User
			db.First(&currentUser, currentUserID.(uint))

			notification := map[string]interface{}{
				"type":      "friend_accepted",
				"from_id":   currentUserID.(uint),
				"from_name": currentUser.Name,
				"message":   "accepted your friend request",
			}
			notificationBytes, _ := json.Marshal(notification)
			toConn.Write(context.Background(), websocket.MessageText, notificationBytes)
		}

		c.JSON(200, gin.H{"message": "friend request accepted"})
	}
}

func RemoveFriend(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")
		friendID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid friend id"})
			return
		}

		if err := repository.RemoveFriend(db, currentUserID.(uint), uint(friendID)); err != nil {
			c.JSON(500, gin.H{"error": "failed to remove friend"})
			return
		}

		c.JSON(200, gin.H{"message": "friend removed"})
	}
}

func BlockUser(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")
		friendID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		if err := repository.BlockUser(db, currentUserID.(uint), uint(friendID)); err != nil {
			c.JSON(500, gin.H{"error": "failed to block user"})
			return
		}

		c.JSON(200, gin.H{"message": "user blocked"})
	}
}

func GetFriendshipStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		currentUserID, _ := c.Get("user_id")
		userID, err := strconv.ParseUint(c.Param("id"), 10, 32)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid user id"})
			return
		}

		status, err := repository.GetFriendshipStatus(db, currentUserID.(uint), uint(userID))
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to get friendship status"})
			return
		}

		c.JSON(200, gin.H{"status": status})
	}
}
