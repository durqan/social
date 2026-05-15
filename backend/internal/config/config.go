package config

import (
	"os"
	"strconv"
	"strings"
)

const (
	defaultPort      = "8080"
	defaultJWTSecret = "your-secret-key-change-in-production"

	defaultRedisHost     = "localhost"
	defaultRedisPort     = "6379"
	defaultRedisPassword = ""
	defaultRedisDB       = 0
)

type Config struct {
	DatabaseURL    string
	Port           string
	JWTSecret      string
	CookieSecure   bool
	AllowedOrigins []string

	RedisHost     string
	RedisPort     string
	RedisPassword string
	RedisDB       int
}

func Load() Config {
	return Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		Port:           getEnv("PORT", defaultPort),
		JWTSecret:      getEnv("JWT_SECRET", defaultJWTSecret),
		CookieSecure:   os.Getenv("COOKIE_SECURE") == "true",
		AllowedOrigins: parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),

		RedisHost:     getEnv("REDIS_HOST", defaultRedisHost),
		RedisPort:     getEnv("REDIS_PORT", defaultRedisPort),
		RedisPassword: getEnv("REDIS_PASSWORD", defaultRedisPassword),
		RedisDB:       getEnvInt("REDIS_DB", defaultRedisDB),
	}
}

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	intValue, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return intValue
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
