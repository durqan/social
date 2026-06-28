package handlers

import (
	"net/http"
	"strconv"
	"strings"

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

func intQuery(c *gin.Context, name string, fallback int, min int, max int) (int, bool) {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < min {
		jsonError(c, http.StatusBadRequest, "invalid "+name)
		return fallback, false
	}
	if value > max {
		return max, true
	}
	return value, true
}

func paginationQuery(c *gin.Context) (limit int, offset int, paginated bool, ok bool) {
	paginated = c.Query("limit") != "" || c.Query("offset") != ""
	limit, ok = intQuery(c, "limit", 20, 1, 50)
	if !ok {
		return 0, 0, paginated, false
	}
	offset, ok = intQuery(c, "offset", 0, 0, 1000000)
	if !ok {
		return 0, 0, paginated, false
	}
	return limit, offset, paginated, true
}

func uintIDsQuery(c *gin.Context, name string, max int) ([]uint, bool) {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		jsonError(c, http.StatusBadRequest, name+" query parameter is required")
		return nil, false
	}

	parts := strings.Split(raw, ",")
	seen := map[uint]bool{}
	ids := make([]uint, 0, len(parts))
	for _, part := range parts {
		value, err := strconv.ParseUint(strings.TrimSpace(part), 10, 32)
		if err != nil || value == 0 {
			jsonError(c, http.StatusBadRequest, "invalid "+name)
			return nil, false
		}
		id := uint(value)
		if seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) > max {
			jsonError(c, http.StatusBadRequest, name+" limit exceeded")
			return nil, false
		}
	}
	return ids, true
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
