package auth

import (
	"errors"
	"fmt"
	"strings"
	"tester/internal/cache"
	"tester/internal/config"
	"tester/internal/utils"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	AccessTokenTTL  = 15 * time.Minute
	RefreshTokenTTL = 30 * 24 * time.Hour

	accessTokenType  = "access"
	refreshTokenType = "refresh"
)

type Claims struct {
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

func GenerateSession(userID uint) (string, string, error) {
	sessionID, err := utils.GenerateSecureToken()
	if err != nil {
		return "", "", err
	}

	if err := storeRefreshSession(userID, sessionID); err != nil {
		return "", "", err
	}

	accessToken, err := GenerateAccessToken(userID, sessionID)
	if err != nil {
		return "", "", err
	}

	refreshToken, err := signToken(userID, sessionID, refreshTokenType, RefreshTokenTTL)
	if err != nil {
		return "", "", err
	}

	return accessToken, refreshToken, nil
}

func GenerateAccessToken(userID uint, sessionID string) (string, error) {
	if userID == 0 || sessionID == "" {
		return "", errors.New("invalid session")
	}

	if err := storeAccessSession(userID, sessionID); err != nil {
		return "", err
	}

	return signToken(userID, sessionID, accessTokenType, AccessTokenTTL)
}

func RefreshAccessToken(refreshToken string) (string, uint, string, error) {
	claims, err := validateClaims(refreshToken, refreshTokenType)
	if err != nil {
		return "", 0, "", err
	}

	if !sessionExists(refreshSessionKey(claims.UserID, claims.SessionID)) {
		return "", 0, "", errors.New("refresh session revoked")
	}

	accessToken, err := GenerateAccessToken(claims.UserID, claims.SessionID)
	if err != nil {
		return "", 0, "", err
	}

	return accessToken, claims.UserID, claims.SessionID, nil
}

func signToken(userID uint, sessionID string, tokenType string, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		TokenType: tokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

func ValidateToken(tokenString string) (uint, string, error) {
	claims, err := validateClaims(tokenString, accessTokenType)
	if err != nil {
		return 0, "", err
	}
	if !sessionExists(accessSessionKey(claims.UserID, claims.SessionID)) {
		return 0, "", errors.New("session revoked")
	}
	return claims.UserID, claims.SessionID, nil
}

func validateClaims(tokenString string, tokenType string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret(), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		if claims.UserID == 0 || claims.SessionID == "" {
			return nil, errors.New("invalid token claims")
		}
		if claims.TokenType != tokenType {
			return nil, errors.New("invalid token type")
		}
		return claims, nil
	}

	return nil, errors.New("invalid token")
}

func RevokeToken(tokenString string) error {
	userID, sessionID, err := ValidateToken(tokenString)
	if err != nil {
		return err
	}
	return RevokeAccessSession(userID, sessionID)
}

func RevokeRefreshToken(tokenString string) error {
	claims, err := validateClaims(tokenString, refreshTokenType)
	if err != nil {
		return err
	}
	return RevokeSession(claims.UserID, claims.SessionID)
}

func RevokeSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	if err := cache.Redis.Delete(accessSessionKey(userID, sessionID)); err != nil {
		return err
	}
	return cache.Redis.Delete(refreshSessionKey(userID, sessionID))
}

func RevokeAccessSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	return cache.Redis.Delete(accessSessionKey(userID, sessionID))
}

func RevokeUserSessionsExcept(userID uint, keepSessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}

	keys, err := scanUserSessionKeys(userID)
	if err != nil {
		return err
	}

	for _, key := range keys {
		if sessionIDFromKey(key) != keepSessionID {
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

	keys, err := scanUserSessionKeys(userID)
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

func storeAccessSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	return cache.Redis.Client.Set(cache.Redis.Ctx, accessSessionKey(userID, sessionID), "1", AccessTokenTTL).Err()
}

func storeRefreshSession(userID uint, sessionID string) error {
	if cache.Redis == nil {
		return errors.New("redis unavailable")
	}
	return cache.Redis.Client.Set(cache.Redis.Ctx, refreshSessionKey(userID, sessionID), "1", RefreshTokenTTL).Err()
}

func sessionExists(key string) bool {
	if cache.Redis == nil {
		return false
	}
	count, err := cache.Redis.Client.Exists(cache.Redis.Ctx, key).Result()
	return err == nil && count == 1
}

func accessSessionKey(userID uint, sessionID string) string {
	return fmt.Sprintf("auth:access:%d:%s", userID, sessionID)
}

func refreshSessionKey(userID uint, sessionID string) string {
	return fmt.Sprintf("auth:refresh:%d:%s", userID, sessionID)
}

func scanUserSessionKeys(userID uint) ([]string, error) {
	accessKeys, err := scanSessionKeys(fmt.Sprintf("auth:access:%d:*", userID))
	if err != nil {
		return nil, err
	}
	refreshKeys, err := scanSessionKeys(fmt.Sprintf("auth:refresh:%d:*", userID))
	if err != nil {
		return nil, err
	}
	return append(accessKeys, refreshKeys...), nil
}

func sessionIDFromKey(key string) string {
	lastColon := strings.LastIndex(key, ":")
	if lastColon == -1 {
		return ""
	}
	return key[lastColon+1:]
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
