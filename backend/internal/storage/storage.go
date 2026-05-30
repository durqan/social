package storage

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

type Object struct {
	Key         string
	URL         string
	ContentType string
	Size        int64
}

type Storage interface {
	Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) (Object, error)
	Delete(ctx context.Context, key string) error
	GetURL(ctx context.Context, key string) (string, error)
	SignedURL(ctx context.Context, key string, ttl time.Duration) (string, error)
}

var (
	defaultStore Storage
	defaultErr   error
	defaultOnce  sync.Once
)

func Default() (Storage, error) {
	defaultOnce.Do(func() {
		switch strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_DRIVER"))) {
		case "", "local":
			defaultStore = NewLocalStorage(
				getEnv("STORAGE_LOCAL_ROOT", "uploads"),
				os.Getenv("STORAGE_PUBLIC_BASE_URL"),
			)
		case "s3":
			defaultStore, defaultErr = NewS3StorageFromEnv()
		default:
			defaultErr = errors.New("unsupported storage driver")
		}
	})

	return defaultStore, defaultErr
}

func getEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func cleanKey(key string) (string, error) {
	key = strings.Trim(strings.ReplaceAll(key, "\\", "/"), "/")
	if key == "" || strings.Contains(key, "../") || strings.Contains(key, "/..") || key == ".." {
		return "", errors.New("invalid storage key")
	}
	return key, nil
}
