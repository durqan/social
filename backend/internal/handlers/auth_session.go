package handlers

import (
	"errors"
	"net/http"
	"strings"

	"tester/internal/auth"
	"tester/internal/config"
	"tester/internal/middleware"
	"tester/internal/utils"

	"github.com/gin-gonic/gin"
)

const authSessionMaxAge = 86400

func startAuthSession(c *gin.Context, userID uint) (string, error) {
	token, err := auth.GenerateToken(userID)
	if err != nil {
		return "", errors.New("failed to generate token")
	}

	setAuthCookie(c, token, authSessionMaxAge)
	if _, err := refreshCSRFCookie(c); err != nil {
		return "", errors.New("failed to create csrf token")
	}

	return token, nil
}

func clearAuthSession(c *gin.Context) {
	setAuthCookie(c, "", -1)
	setCSRFCookie(c, "", -1)
}

func currentAuthToken(c *gin.Context) string {
	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, middleware.BearerPrefix) {
		return strings.TrimPrefix(authHeader, middleware.BearerPrefix)
	}

	if cookieToken, err := c.Cookie(middleware.AuthCookieName); err == nil {
		return cookieToken
	}

	return ""
}

func setAuthCookie(c *gin.Context, token string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		middleware.AuthCookieName,
		token,
		maxAge,
		"/",
		"",
		secureCookie(),
		true,
	)
}

func secureCookie() bool {
	return config.Load().CookieSecure
}

func GetCSRFToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := refreshCSRFCookie(c)
		if err != nil {
			c.JSON(500, gin.H{"error": "failed to create csrf token"})
			return
		}
		c.JSON(200, gin.H{"csrf_token": token})
	}
}

func refreshCSRFCookie(c *gin.Context) (string, error) {
	token, err := utils.GenerateSecureToken()
	if err != nil {
		return "", err
	}
	setCSRFCookie(c, token, authSessionMaxAge)
	return token, nil
}

func setCSRFCookie(c *gin.Context, token string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		middleware.CSRFCookieName,
		token,
		maxAge,
		"/",
		"",
		secureCookie(),
		false,
	)
}
