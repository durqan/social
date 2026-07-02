package services

import (
	"os"
	"path/filepath"
	"testing"

	"tester/internal/cache"
	"tester/internal/storage"
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

func TestNormalizeMessageAttachmentsAcceptsEncryptedAttachmentWithoutPlaintextMetadata(t *testing.T) {
	root := t.TempDir()
	restoreStorage := storage.SetDefaultForTest(storage.NewLocalStorage(root, ""))
	t.Cleanup(restoreStorage)

	const userID uint = 42
	const filename = "42_attachment.bin"
	key := EncryptedChatUploadKey(filename, userID)
	path := filepath.Join(root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("encrypted blob"), 0600); err != nil {
		t.Fatal(err)
	}

	attachments, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:           PrivateUploadURL(filename),
			FileType:          "file",
			Size:              14,
			OriginalFilename:  "plain-name.jpg",
			ContentType:       "image/jpeg",
			EncryptionVersion: 1,
			EncryptedFileKey:  `{"version":1,"keyAlg":"RSA-OAEP-SHA-256","keys":{"42":"a2V5","7":"a2V5"}}`,
			FileNonce:         "MTIzNDU2Nzg5MDEy",
			EncryptedMetadata: `{"version":1,"alg":"AES-256-GCM","nonce":"MTIzNDU2Nzg5MDEy","data":"bWV0YQ=="}`,
		},
	}, userID)
	if err != nil {
		t.Fatal(err)
	}
	if len(attachments) != 1 {
		t.Fatalf("attachments = %d, want 1", len(attachments))
	}

	attachment := attachments[0]
	if attachment.FileURL != key || attachment.FileType != "file" || attachment.Size != 14 {
		t.Fatalf("normalized attachment = %+v", attachment)
	}
	if attachment.EncryptionVersion != 1 ||
		attachment.EncryptedFileKey == "" ||
		attachment.FileNonce == "" ||
		attachment.EncryptedMetadata == "" {
		t.Fatalf("encrypted fields were not preserved: %+v", attachment)
	}
	if attachment.OriginalFilename != "" || attachment.ContentType != "" {
		t.Fatalf("plaintext metadata leaked into encrypted attachment: %+v", attachment)
	}
}
