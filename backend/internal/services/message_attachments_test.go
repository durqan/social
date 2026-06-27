package services

import (
	"testing"

	"tester/internal/cache"
)

func TestChatUploadOwnedByDoesNotTrustGeneratedFilenameWithoutRedis(t *testing.T) {
	previousRedis := cache.Redis
	cache.Redis = nil
	t.Cleanup(func() {
		cache.Redis = previousRedis
	})

	filename := "550e8400-e29b-41d4-a716-446655440000.jpg"
	if ChatUploadOwnedBy(filename, 42) {
		t.Fatal("ChatUploadOwnedBy trusted generated filename without Redis ownership state")
	}
}
