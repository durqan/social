package handlers

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const (
	authCookieName   = "token"
	bearerPrefix     = "Bearer "
	accessTokenType  = "access"
	defaultJWTSecret = "your-secret-key-change-in-production"
)

type authClaims struct {
	UserID    uint   `json:"user_id"`
	SessionID string `json:"session_id"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

var allowedOrigins = []string{
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:5175",
}

func ConfigureAllowedOrigins(origins []string) {
	if len(origins) == 0 {
		return
	}
	allowedOrigins = origins
}

func originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func userIDFromRequest(r *http.Request) (uint, error) {
	tokenString := authTokenFromRequest(r)
	if tokenString == "" {
		return 0, errors.New("missing token")
	}

	token, err := jwt.ParseWithClaims(tokenString, &authClaims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(jwtSecret()), nil
	})
	if err != nil {
		return 0, err
	}

	claims, ok := token.Claims.(*authClaims)
	if !ok || !token.Valid || claims.UserID == 0 || claims.SessionID == "" || claims.TokenType != accessTokenType {
		return 0, errors.New("invalid token")
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
