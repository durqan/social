package db

import (
	"tester/internal/config"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func NewDB(cfg config.Config) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{
		TranslateError: true,
	})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	if cfg.DBMaxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConns)
	}
	if cfg.DBMaxIdleConns > 0 {
		sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConns)
	}
	if cfg.DBConnMaxLifetimeMin > 0 {
		sqlDB.SetConnMaxLifetime(time.Duration(cfg.DBConnMaxLifetimeMin) * time.Minute)
	}
	if cfg.DBConnMaxIdleTimeMin > 0 {
		sqlDB.SetConnMaxIdleTime(time.Duration(cfg.DBConnMaxIdleTimeMin) * time.Minute)
	}
	return db, nil
}
