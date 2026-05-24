package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func jsonError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": message})
}

func authenticatedUserID(c *gin.Context) (uint, bool) {
	value, ok := c.Get("user_id")
	if !ok {
		jsonError(c, http.StatusUnauthorized, "unauthorized")
		return 0, false
	}

	userID, ok := value.(uint)
	if !ok {
		jsonError(c, http.StatusUnauthorized, "unauthorized")
		return 0, false
	}

	return userID, true
}

func uintParam(c *gin.Context, name string, errorMessage string) (uint, bool) {
	value, err := strconv.ParseUint(c.Param(name), 10, 32)
	if err != nil {
		jsonError(c, http.StatusBadRequest, errorMessage)
		return 0, false
	}
	return uint(value), true
}

func requireOwnUser(c *gin.Context, paramName string, forbiddenMessage string) (uint, bool) {
	authUserID, ok := authenticatedUserID(c)
	if !ok {
		return 0, false
	}

	targetUserID, ok := uintParam(c, paramName, "invalid user id")
	if !ok {
		return 0, false
	}

	if targetUserID != authUserID {
		jsonError(c, http.StatusForbidden, forbiddenMessage)
		return 0, false
	}

	return targetUserID, true
}
