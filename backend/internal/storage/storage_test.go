package storage

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestLocalStorageUploadDeleteURL(t *testing.T) {
	root := t.TempDir()
	store := NewLocalStorage(root, "http://assets.local/uploads")
	key := "avatars/user_123/avatar.webp"

	if err := store.Upload(context.Background(), key, strings.NewReader("avatar-bytes"), "image/webp"); err != nil {
		t.Fatalf("upload: %v", err)
	}

	path := filepath.Join(root, "avatars", "user_123", "avatar.webp")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read uploaded file: %v", err)
	}
	if string(data) != "avatar-bytes" {
		t.Fatalf("unexpected uploaded bytes %q", data)
	}

	url, err := store.URL(context.Background(), key)
	if err != nil {
		t.Fatalf("url: %v", err)
	}
	if url != "http://assets.local/uploads/avatars/user_123/avatar.webp" {
		t.Fatalf("unexpected url %q", url)
	}

	if err := store.Delete(context.Background(), key); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected uploaded file to be deleted, stat err: %v", err)
	}
}

func TestNewObjectKeyGeneratesSafeUUIDKey(t *testing.T) {
	key, err := NewObjectKey("avatars/user_123", ".webp")
	if err != nil {
		t.Fatalf("new object key: %v", err)
	}

	pattern := regexp.MustCompile(`^avatars/user_123/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$`)
	if !pattern.MatchString(key) {
		t.Fatalf("object key %q does not match safe UUID pattern", key)
	}

	if _, err := NewObjectKey("../avatars", ".webp"); err == nil {
		t.Fatal("expected invalid prefix to be rejected")
	}
	if _, err := NewObjectKey("avatars/user_123", "../avatar.webp"); err == nil {
		t.Fatal("expected invalid extension to be rejected")
	}
}
