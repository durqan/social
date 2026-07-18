package config

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"

	"tester/internal/messagecrypto"
)

const (
	defaultPort      = "8080"
	defaultJWTSecret = "your-secret-key-change-in-production"
	defaultDatabase  = "postgres://social:social@localhost:5433/social?sslmode=disable"

	defaultRedisHost     = "localhost"
	defaultRedisPort     = "6379"
	defaultRedisPassword = ""
	defaultRedisDB       = 0

	defaultDBMaxOpenConns       = 25
	defaultDBMaxIdleConns       = 25
	defaultDBConnMaxLifetimeMin = 30
	defaultDBConnMaxIdleTimeMin = 5
)

type Config struct {
	DatabaseURL  string
	Port         string
	JWTSecret    string
	CookieSecure bool

	RedisHost     string
	RedisPort     string
	RedisPassword string
	RedisDB       int

	DBMaxOpenConns       int
	DBMaxIdleConns       int
	DBConnMaxLifetimeMin int
	DBConnMaxIdleTimeMin int
}

var (
	loadOnce sync.Once
	cached   Config
)

func Load() Config {
	loadOnce.Do(func() {
		lockedEnv := currentEnvKeys()
		loadDotEnv(".env", lockedEnv)

		cached = Config{
			DatabaseURL:  getEnv("DATABASE_URL", defaultDatabase),
			Port:         getEnv("PORT", defaultPort),
			JWTSecret:    getEnv("JWT_SECRET", defaultJWTSecret),
			CookieSecure: os.Getenv("COOKIE_SECURE") == "true",

			RedisHost:     getEnv("REDIS_HOST", defaultRedisHost),
			RedisPort:     getEnv("REDIS_PORT", defaultRedisPort),
			RedisPassword: getEnv("REDIS_PASSWORD", defaultRedisPassword),
			RedisDB:       getEnvInt("REDIS_DB", defaultRedisDB),

			DBMaxOpenConns:       getEnvInt("DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns),
			DBMaxIdleConns:       getEnvInt("DB_MAX_IDLE_CONNS", defaultDBMaxIdleConns),
			DBConnMaxLifetimeMin: getEnvInt("DB_CONN_MAX_LIFETIME_MINUTES", defaultDBConnMaxLifetimeMin),
			DBConnMaxIdleTimeMin: getEnvInt("DB_CONN_MAX_IDLE_TIME_MINUTES", defaultDBConnMaxIdleTimeMin),
		}

		validateSecurity(cached)
	})

	return cached
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

func validateSecurity(cfg Config) {
	if os.Getenv("GIN_MODE") != "release" {
		return
	}

	if len(cfg.JWTSecret) < 32 || strings.Contains(cfg.JWTSecret, "your-secret-key") {
		log.Fatal("JWT_SECRET must be changed and contain at least 32 characters in release mode")
	}
	if err := messagecrypto.ValidateProductionKey(); err != nil {
		log.Fatal(err)
	}
}
