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

func startAuthSession(c *gin.Context, userID uint) (string, error) {
	accessToken, refreshToken, err := auth.GenerateSession(userID)
	if err != nil {
		return "", errors.New("failed to generate token")
	}

	setAuthCookie(c, accessToken, int(auth.AccessTokenTTL.Seconds()))
	setRefreshCookie(c, refreshToken, int(auth.RefreshTokenTTL.Seconds()))
	if _, err := refreshCSRFCookie(c); err != nil {
		return "", errors.New("failed to create csrf token")
	}

	return accessToken, nil
}

func clearAuthSession(c *gin.Context) {
	setAuthCookie(c, "", -1)
	setRefreshCookie(c, "", -1)
	setCSRFCookie(c, "", -1)
}

func currentAuthToken(c *gin.Context) string {
	if cookieToken, err := c.Cookie(middleware.AuthCookieName); err == nil {
		return cookieToken
	}

	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, middleware.BearerPrefix) {
		return strings.TrimPrefix(authHeader, middleware.BearerPrefix)
	}

	return ""
}

func currentRefreshToken(c *gin.Context) string {
	if cookieToken, err := c.Cookie(middleware.RefreshCookieName); err == nil {
		return cookieToken
	}

	return ""
}

func setAuthCookie(c *gin.Context, token string, maxAge int) {
	setHTTPOnlyCookie(c, middleware.AuthCookieName, token, maxAge)
}

func setRefreshCookie(c *gin.Context, token string, maxAge int) {
	setHTTPOnlyCookie(c, middleware.RefreshCookieName, token, maxAge)
}

func setHTTPOnlyCookie(c *gin.Context, name string, value string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		name,
		value,
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
	setCSRFCookie(c, token, int(auth.RefreshTokenTTL.Seconds()))
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
