package auth

import (
	"errors"
	"fmt"
	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/utils"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const sessionTTL = 24 * time.Hour

type Claims struct {
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"`
	jwt.RegisteredClaims
}

func GenerateToken(userID uint) (string, error) {
	sessionID, err := utils.GenerateSecureToken()
	if err != nil {
		return "", err
	}

	if err := storeSession(userID, sessionID); err != nil {
		return "", err
	}

	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(sessionTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

func ValidateToken(tokenString string) (uint, string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret(), nil
	})

	if err != nil {
		return 0, "", err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		if claims.UserID == 0 || claims.SessionID == "" {
			return 0, "", errors.New("invalid token claims")
		}
		if !sessionExists(claims.UserID, claims.SessionID) {
			return 0, "", errors.New("session revoked")
		}
		return claims.UserID, claims.SessionID, nil
	}

	return 0, "", errors.New("invalid token")
}

func RevokeToken(tokenString string) error {
	userID, sessionID, err := ValidateToken(tokenString)
	if err != nil {
		return err
	}
	return RevokeSession(userID, sessionID)
}

func RevokeSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	return cache.Redis.Delete(sessionKey(userID, sessionID))
}

func RevokeUserSessionsExcept(userID uint, keepSessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}

	pattern := fmt.Sprintf("auth:session:%d:*", userID)
	keys, err := scanSessionKeys(pattern)
	if err != nil {
		return err
	}

	keepKey := sessionKey(userID, keepSessionID)
	for _, key := range keys {
		if key != keepKey {
			if err := cache.Redis.Delete(key); err != nil {
				return err
			}
		}
	}
	return nil
}

func RevokeUserSessions(userID uint) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}

	pattern := fmt.Sprintf("auth:session:%d:*", userID)
	keys, err := scanSessionKeys(pattern)
	if err != nil {
		return err
	}

	for _, key := range keys {
		if err := cache.Redis.Delete(key); err != nil {
			return err
		}
	}
	return nil
}

func jwtSecret() []byte {
	return []byte(config.Load().JWTSecret)
}

func storeSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	return cache.Redis.Client.Set(cache.Redis.Ctx, sessionKey(userID, sessionID), "1", sessionTTL).Err()
}

func sessionExists(userID uint, sessionID string) bool {
	if cache.Redis == nil {
		return false
	}
	count, err := cache.Redis.Client.Exists(cache.Redis.Ctx, sessionKey(userID, sessionID)).Result()
	return err == nil && count == 1
}

func sessionKey(userID uint, sessionID string) string {
	return fmt.Sprintf("auth:session:%d:%s", userID, sessionID)
}

func scanSessionKeys(pattern string) ([]string, error) {
	var cursor uint64
	var keys []string

	for {
		batch, nextCursor, err := cache.Redis.Client.Scan(cache.Redis.Ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return keys, nil
}
