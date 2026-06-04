package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type LocalStorage struct {
	root       string
	publicBase string
}

func NewLocalStorage(root string, publicBase string) *LocalStorage {
	root = strings.TrimSpace(root)
	if root == "" {
		root = "uploads"
	}

	return &LocalStorage{
		root:       filepath.Clean(root),
		publicBase: strings.TrimRight(strings.TrimSpace(publicBase), "/"),
	}
}

func (s *LocalStorage) Upload(_ context.Context, key string, reader io.Reader, contentType string) error {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return err
	}

	path := filepath.Join(s.root, filepath.FromSlash(cleanedKey))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(file, reader)
	return err
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

func (s *LocalStorage) URL(_ context.Context, key string) (string, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", err
	}

	if s.publicBase != "" {
		return s.publicBase + "/" + escapeKey(cleanedKey), nil
	}

	return "/" + strings.TrimPrefix(filepath.ToSlash(filepath.Join(s.root, filepath.FromSlash(cleanedKey))), "/"), nil
}

func (s *LocalStorage) Path(key string) (string, bool) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", false
	}
	return filepath.Join(s.root, filepath.FromSlash(cleanedKey)), true
}
