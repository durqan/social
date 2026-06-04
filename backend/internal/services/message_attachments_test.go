package services

import (
	"strings"
	"testing"
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
