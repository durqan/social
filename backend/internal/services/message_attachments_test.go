package services

import (
	"strings"
	"testing"

	"tester/internal/cache"
)

func TestNormalizeVoiceAttachmentRejectsInvalidOwner(t *testing.T) {
	_, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL("1_voice.ogg"),
			FileType:        "voice",
			DurationSeconds: 2,
			Size:            128,
		},
	}, 2)

	if err == nil || !strings.Contains(err.Error(), "invalid voice owner") {
		t.Fatalf("expected invalid voice owner error, got %v", err)
	}
}

func TestNormalizeVideoNoteAttachmentRejectsMixWithVoice(t *testing.T) {
	_, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL("a.webm"),
			FileType:        "video_note",
			DurationSeconds: 3,
			Size:            1024,
		},
		{
			FileURL:         PrivateUploadURL("b.webm"),
			FileType:        "voice",
			DurationSeconds: 2,
			Size:            128,
		},
	}, 1)

	if err == nil || !strings.Contains(err.Error(), "cannot mix video note") {
		t.Fatalf("expected mix video note error, got %v", err)
	}
}

func TestValidateChatVideoNoteDurationSecondsRejectsTooLong(t *testing.T) {
	_, err := ValidateChatVideoNoteDurationSeconds(999)
	if err == nil || !strings.Contains(err.Error(), "video note is too long") {
		t.Fatalf("expected too long error, got %v", err)
	}
}

func TestNormalizeVideoNoteRejectsInvalidOwner(t *testing.T) {
	_, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL("evil-note.webm"),
			FileType:        "video_note",
			DurationSeconds: 3,
			Size:            1024,
		},
	}, 1)

	if err == nil || !strings.Contains(err.Error(), "invalid video note owner") {
		t.Fatalf("expected invalid video note owner error, got %v", err)
	}
}

// TestChatUploadOwnedByFallbackDocumentsRedisRequirement tests the owner check fallback
// behavior for generated (uuid) filenames used by video notes / voice / images.
// It documents that without Redis the pattern allows attach (for dev), but Redis is
// needed in prod to bind owner and prevent theoretical cross-user uuid replay.
func TestChatUploadOwnedByFallbackDocumentsRedisRequirement(t *testing.T) {
	if cache.Redis != nil {
		t.Skip("fallback test only runs when cache.Redis is nil (no-redis dev scenario)")
	}

	// valid generated uuid filename (as produced by NewObjectKey in upload handlers)
	good := "12345678-1234-4abc-8123-1234567890ab.webm"
	if !ChatUploadOwnedBy(good, 42) {
		t.Fatalf("no-redis fallback should accept generated uuid filename (current weak fallback for dev)")
	}

	// non-matching must always reject
	bad := "evil-note.webm"
	if ChatUploadOwnedBy(bad, 42) {
		t.Fatalf("non-generated must be rejected even in fallback")
	}

	// legacy prefix still works (prefix check is before redis check)
	legacy := "42_legacy.jpg"
	if !ChatUploadOwnedBy(legacy, 42) {
		t.Fatalf("legacy user-prefixed filename must be owned by its user regardless of redis")
	}
	legacyOther := "1_legacy.jpg"
	if ChatUploadOwnedBy(legacyOther, 42) {
		t.Fatalf("legacy for other user must not be owned")
	}
}
