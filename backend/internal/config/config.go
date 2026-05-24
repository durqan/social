package config

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
)

const (
	defaultPort      = "8080"
	defaultJWTSecret = "your-secret-key-change-in-production"
	defaultDatabase  = "postgres://social:social@localhost:5432/social?sslmode=disable"

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
	lockedEnv := currentEnvKeys()
	loadDotEnv(".env", lockedEnv)

	cfg := Config{
		DatabaseURL:    getEnv("DATABASE_URL", defaultDatabase),
		Port:           getEnv("PORT", defaultPort),
		JWTSecret:      getEnv("JWT_SECRET", defaultJWTSecret),
		CookieSecure:   os.Getenv("COOKIE_SECURE") == "true",
		AllowedOrigins: parseAllowedOrigins(os.Getenv("CORS_ALLOWED_ORIGINS")),

		RedisHost:     getEnv("REDIS_HOST", defaultRedisHost),
		RedisPort:     getEnv("REDIS_PORT", defaultRedisPort),
		RedisPassword: getEnv("REDIS_PASSWORD", defaultRedisPassword),
		RedisDB:       getEnvInt("REDIS_DB", defaultRedisDB),
	}

	validateSecurity(cfg)

	return cfg
}

func currentEnvKeys() map[string]struct{} {
	keys := make(map[string]struct{})
	for _, pair := range os.Environ() {
		key, _, ok := strings.Cut(pair, "=")
		if ok {
			keys[key] = struct{}{}
		}
	}
	return keys
}

func loadDotEnv(path string, lockedEnv map[string]struct{}) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}

		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if key == "" {
			continue
		}
		if _, locked := lockedEnv[key]; locked {
			continue
		}

		os.Setenv(key, value)
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

func validateSecurity(cfg Config) {
	if os.Getenv("GIN_MODE") != "release" {
		return
	}

	if len(cfg.JWTSecret) < 32 || strings.Contains(cfg.JWTSecret, "your-secret-key") {
		log.Fatal("JWT_SECRET must be changed and contain at least 32 characters in release mode")
	}
}
