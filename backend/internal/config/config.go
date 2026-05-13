package config

import (
	"os"
	"strings"
)

const (
	defaultPort      = "8080"
	defaultJWTSecret = "your-secret-key-change-in-production"
)

type Config struct {
	DatabaseURL    string
	Port           string
	JWTSecret      string
	CookieSecure   bool
	AllowedOrigins []string
}

func Load() Config {
	return Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		Port:           getEnv("PORT", defaultPort),
		JWTSecret:      getEnv("JWT_SECRET", defaultJWTSecret),
		CookieSecure:   os.Getenv("COOKIE_SECURE") == "true",
		AllowedOrigins: parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),
	}
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func parseAllowedOrigins(value string) []string {
	if value == "" {
		return []string{"http://localhost", "http://localhost:5173", "http://localhost:80"}
	}

	parts := strings.Split(value, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		origin := strings.TrimSpace(part)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}
