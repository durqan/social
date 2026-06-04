package auth

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"notifications/cache"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	authCookieName   = "token"
	bearerPrefix     = "Bearer "
	accessTokenType  = "access"
	defaultJWTSecret = "your-secret-key-change-in-production"
)

type Claims struct {
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, err := UserIDFromRequest(c.Request)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)
		c.Next()
	}
}

func UserID(c *gin.Context) (uint, bool) {
	value, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
		return 0, false
	}
	userID, ok := value.(uint)
	if !ok || userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
		return 0, false
	}
	return userID, true
}

func UserIDFromRequest(r *http.Request) (uint, error) {
	tokenString := authTokenFromRequest(r)
	if tokenString == "" {
		return 0, errors.New("missing token")
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(jwtSecret()), nil
	})
	if err != nil {
		return 0, err
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid || claims.UserID == 0 || claims.SessionID == "" || claims.TokenType != accessTokenType {
		return 0, errors.New("invalid token")
	}

	if !isAccessSessionValid(claims.UserID, claims.SessionID) {
		return 0, errors.New("session revoked")
	}

	return claims.UserID, nil
}

func jwtSecret() string {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return defaultJWTSecret
	}
	return secret
}

func authTokenFromRequest(r *http.Request) string {
	if cookie, err := r.Cookie(authCookieName); err == nil {
		return cookie.Value
	}
	if authHeader := r.Header.Get("Authorization"); strings.HasPrefix(authHeader, bearerPrefix) {
		return strings.TrimPrefix(authHeader, bearerPrefix)
	}
	return ""
}

// isAccessSessionValid checks Redis for an active access session (revocation support).
// Mirrors the check performed by the main backend.
func isAccessSessionValid(userID uint, sessionID string) bool {
	if cache.Redis == nil {
		return false
	}
	key := accessSessionKey(userID, sessionID)
	exists, err := cache.Redis.Exists(key)
	return err == nil && exists
}

func accessSessionKey(userID uint, sessionID string) string {
	return fmt.Sprintf("auth:access:%d:%s", userID, sessionID)
}
