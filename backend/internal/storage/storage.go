package storage

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

var ErrInvalidKey = errors.New("invalid storage key")

type Storage interface {
	Upload(ctx context.Context, key string, r io.Reader, contentType string) error
	Delete(ctx context.Context, key string) error
	URL(ctx context.Context, key string) (string, error)
}

type SignedURLer interface {
	SignedURL(ctx context.Context, key string, ttl time.Duration) (string, error)
}

type LocalPathProvider interface {
	Path(key string) (string, bool)
}

var (
	defaultMu     sync.Mutex
	defaultStore  Storage
	defaultErr    error
	defaultLoaded bool
)

func Default() (Storage, error) {
	defaultMu.Lock()
	defer defaultMu.Unlock()

	if !defaultLoaded {
		defaultStore, defaultErr = newDefaultStorageFromEnv()
		defaultLoaded = true
	}

	return defaultStore, defaultErr
}

func SetDefaultForTest(store Storage) func() {
	defaultMu.Lock()
	previousStore := defaultStore
	previousErr := defaultErr
	previousLoaded := defaultLoaded
	defaultStore = store
	defaultErr = nil
	defaultLoaded = true
	defaultMu.Unlock()

	return func() {
		defaultMu.Lock()
		defaultStore = previousStore
		defaultErr = previousErr
		defaultLoaded = previousLoaded
		defaultMu.Unlock()
	}
}

func ResetDefaultForTest() {
	defaultMu.Lock()
	defaultStore = nil
	defaultErr = nil
	defaultLoaded = false
	defaultMu.Unlock()
}

func newDefaultStorageFromEnv() (Storage, error) {
	driver := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_DRIVER")))
	if driver == "" {
		if strings.EqualFold(os.Getenv("GIN_MODE"), "release") {
			driver = "s3"
		} else {
			driver = "local"
		}
	}

	switch driver {
	case "local":
		return NewLocalStorage(
			getEnv("STORAGE_LOCAL_ROOT", "uploads"),
			os.Getenv("STORAGE_PUBLIC_BASE_URL"),
		), nil
	case "s3":
		return NewS3StorageFromEnv()
	default:
		return nil, errors.New("unsupported storage driver")
	}
}

func CleanKey(key string) (string, error) {
	return cleanKey(key)
}

func NewObjectKey(prefix string, ext string) (string, error) {
	cleanPrefix, err := cleanKey(prefix)
	if err != nil {
		return "", err
	}

	cleanExt, err := cleanExtension(ext)
	if err != nil {
		return "", err
	}

	id, err := NewUUID()
	if err != nil {
		return "", err
	}

	return cleanPrefix + "/" + id + cleanExt, nil
}

func NewUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}

	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80

	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

func KeyFromStoredValue(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}

	if parsed, err := url.Parse(value); err == nil && parsed.IsAbs() {
		if key, ok := keyFromConfiguredBase(value); ok {
			return key, true
		}
		if key, ok := keyFromURL(parsed); ok {
			return key, true
		}
		return "", false
	}

	return keyFromPathLike(value)
}

func URLForStoredValue(ctx context.Context, store Storage, value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil
	}

	key, ok := KeyFromStoredValue(value)
	if !ok {
		return value, nil
	}

	return store.URL(ctx, key)
}

func DeleteStoredValue(ctx context.Context, store Storage, value string) error {
	key, ok := KeyFromStoredValue(value)
	if !ok {
		return nil
	}
	return store.Delete(ctx, key)
}

func LocalPath(store Storage, key string) (string, bool) {
	local, ok := store.(LocalPathProvider)
	if !ok {
		return "", false
	}
	return local.Path(key)
}

func SignedURL(ctx context.Context, store Storage, key string, ttl time.Duration) (string, error) {
	if signer, ok := store.(SignedURLer); ok {
		return signer.SignedURL(ctx, key, ttl)
	}
	return store.URL(ctx, key)
}

func cleanKey(key string) (string, error) {
	key = strings.Trim(strings.ReplaceAll(strings.TrimSpace(key), "\\", "/"), "/")
	if key == "" || strings.Contains(key, "://") || strings.ContainsRune(key, '\x00') {
		return "", ErrInvalidKey
	}

	parts := strings.Split(key, "/")
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsRune(part, '\x00') {
			return "", ErrInvalidKey
		}
	}

	return strings.Join(parts, "/"), nil
}

func cleanExtension(ext string) (string, error) {
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == "" || !strings.HasPrefix(ext, ".") || strings.ContainsAny(ext, `/\\`) || strings.Contains(ext, "..") {
		return "", ErrInvalidKey
	}
	for _, r := range ext[1:] {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return "", ErrInvalidKey
		}
	}
	return ext, nil
}

func getEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func keyFromConfiguredBase(value string) (string, bool) {
	for _, base := range []string{
		os.Getenv("S3_PUBLIC_BASE_URL"),
		os.Getenv("STORAGE_PUBLIC_BASE_URL"),
	} {
		base = strings.TrimRight(strings.TrimSpace(base), "/")
		if base == "" {
			continue
		}
		if value == base {
			return "", false
		}
		if strings.HasPrefix(value, base+"/") {
			unescaped, err := url.PathUnescape(strings.TrimPrefix(value, base+"/"))
			if err != nil {
				return "", false
			}
			return keyFromPathLike(unescaped)
		}
	}
	return "", false
}

func keyFromURL(parsed *url.URL) (string, bool) {
	path, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil {
		return "", false
	}

	if key, ok := keyFromPathLike(path); ok {
		return key, true
	}

	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	if bucket != "" {
		if strings.HasPrefix(strings.TrimPrefix(path, "/"), bucket+"/") {
			return keyFromPathLike(strings.TrimPrefix(strings.TrimPrefix(path, "/"), bucket+"/"))
		}
		if strings.HasPrefix(parsed.Host, bucket+".") {
			return keyFromPathLike(path)
		}
	}

	return "", false
}

func keyFromPathLike(value string) (string, bool) {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	value = strings.TrimPrefix(value, "/")

	if strings.HasPrefix(value, "uploads/") {
		value = strings.TrimPrefix(value, "uploads/")
	}

	key, err := cleanKey(value)
	if err != nil {
		return "", false
	}
	if !looksLikeObjectKey(key) {
		return "", false
	}
	return key, true
}

func looksLikeObjectKey(key string) bool {
	for _, prefix := range []string{"avatars/", "messages/", "voice/", "posts/", "chat/"} {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}
