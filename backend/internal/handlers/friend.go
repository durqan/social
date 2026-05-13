package handlers

import (
	"strconv"
	"tester/internal/repository"

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
