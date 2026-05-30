package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type LocalStorage struct {
	root       string
	publicBase string
}

func NewLocalStorage(root string, publicBase string) *LocalStorage {
	return &LocalStorage{
		root:       strings.Trim(strings.TrimSpace(root), "/"),
		publicBase: strings.TrimRight(strings.TrimSpace(publicBase), "/"),
	}
}

func (s *LocalStorage) Upload(_ context.Context, key string, reader io.Reader, size int64, contentType string) (Object, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return Object{}, err
	}

	path := filepath.Join(s.root, filepath.FromSlash(cleanedKey))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return Object{}, err
	}

	file, err := os.Create(path)
	if err != nil {
		return Object{}, err
	}
	defer file.Close()

	written, err := io.Copy(file, reader)
	if err != nil {
		return Object{}, err
	}
	if size <= 0 {
		size = written
	}

	url, err := s.GetURL(context.Background(), cleanedKey)
	if err != nil {
		return Object{}, err
	}

	return Object{
		Key:         cleanedKey,
		URL:         url,
		ContentType: contentType,
		Size:        size,
	}, nil
}

func (s *LocalStorage) Delete(_ context.Context, key string) error {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return err
	}

	err = os.Remove(filepath.Join(s.root, filepath.FromSlash(cleanedKey)))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *LocalStorage) GetURL(_ context.Context, key string) (string, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", err
	}

	if s.publicBase != "" {
		return s.publicBase + "/" + cleanedKey, nil
	}

	return "/" + filepath.ToSlash(filepath.Join(s.root, filepath.FromSlash(cleanedKey))), nil
}

func (s *LocalStorage) SignedURL(ctx context.Context, key string, _ time.Duration) (string, error) {
	return s.GetURL(ctx, key)
}

func (s *LocalStorage) Path(key string) (string, bool) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", false
	}
	return filepath.Join(s.root, filepath.FromSlash(cleanedKey)), true
}

func LocalPath(store Storage, key string) (string, bool) {
	local, ok := store.(*LocalStorage)
	if !ok {
		return "", false
	}
	return local.Path(key)
}
