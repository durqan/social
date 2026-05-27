package db

import (
	"errors"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

	return db, nil
}
