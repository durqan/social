package services

import (
	"context"
	"io"
	"sort"
	"strings"
	"testing"
	"time"

	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCleanupAbandonedUploadsDeletesOnlyOldUnreferencedObjects(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.MessageAttachment{}); err != nil {
		t.Fatal(err)
	}

	old := time.Now().Add(-48 * time.Hour)
	recent := time.Now()
	store := &fakeCleanupStore{
		objects: []storage.ObjectInfo{
			{Key: "messages/user_1/orphan.jpg", LastModified: old, Size: 1},
			{Key: "messages/user_1/referenced.jpg", LastModified: old, Size: 1},
			{Key: "voice/user_1/recent.webm", LastModified: recent, Size: 1},
		},
	}
	restore := storage.SetDefaultForTest(store)
	defer restore()

	if err := db.Create(&models.MessageAttachment{
		MessageID: 1,
		FileURL:   "messages/user_1/referenced.jpg",
		FileType:  "image",
		Size:      1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	deleted, err := CleanupAbandonedUploads(context.Background(), db, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted = %d, want 1", deleted)
	}

	sort.Strings(store.deleted)
	wantDeleted := []string{"messages/user_1/orphan.jpg"}
	if len(store.deleted) != len(wantDeleted) || store.deleted[0] != wantDeleted[0] {
		t.Fatalf("deleted keys = %#v, want %#v", store.deleted, wantDeleted)
	}
}

type fakeCleanupStore struct {
	objects []storage.ObjectInfo
	deleted []string
}

func (f *fakeCleanupStore) Upload(context.Context, string, io.Reader, string) error {
	return nil
}

func (f *fakeCleanupStore) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return nil
}

func (f *fakeCleanupStore) URL(context.Context, string) (string, error) {
	return "", nil
}

func (f *fakeCleanupStore) ListPrefix(_ context.Context, prefix string) ([]storage.ObjectInfo, error) {
	var objects []storage.ObjectInfo
	for _, object := range f.objects {
		if strings.HasPrefix(object.Key, prefix) {
			objects = append(objects, object)
		}
	}
	return objects, nil
}
