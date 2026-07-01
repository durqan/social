package db

import (
	"errors"
	"os"
	"strconv"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	defaultDBMaxOpenConns       = 25
	defaultDBMaxIdleConns       = 25
	defaultDBConnMaxLifetimeMin = 30
	defaultDBConnMaxIdleTimeMin = 5
)

func NewDB() (*gorm.DB, error) {
	dataBaseURL := os.Getenv("DATABASE_URL")
	if dataBaseURL == "" {
		return nil, errors.New("DATABASE_URL environment variable not set")
	}

	db, err := gorm.Open(postgres.Open(dataBaseURL), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", defaultDBMaxOpenConns))
	sqlDB.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", defaultDBMaxIdleConns))
	sqlDB.SetConnMaxLifetime(time.Duration(envInt("DB_CONN_MAX_LIFETIME_MINUTES", defaultDBConnMaxLifetimeMin)) * time.Minute)
	sqlDB.SetConnMaxIdleTime(time.Duration(envInt("DB_CONN_MAX_IDLE_TIME_MINUTES", defaultDBConnMaxIdleTimeMin)) * time.Minute)

	return db, nil
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}
