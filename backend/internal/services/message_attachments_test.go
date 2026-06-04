package services

import (
	"context"
	"io"
	"strings"
	"testing"

	"tester/internal/storage"
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

type attachmentMockStorage struct{}

func (attachmentMockStorage) Upload(_ context.Context, _ string, _ io.Reader, _ string) error {
	return nil
}

func (attachmentMockStorage) Delete(_ context.Context, _ string) error {
	return nil
}

func (attachmentMockStorage) URL(_ context.Context, key string) (string, error) {
	return "/uploads/" + key, nil
}

func TestNormalizeVideoNoteAttachmentWithTextCapableMessage(t *testing.T) {
	defer storage.SetDefaultForTest(attachmentMockStorage{})()

	filename := "00000000-0000-4000-8000-000000000001.webm"
	attachments, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL(filename),
			FileType:        "video_note",
			DurationSeconds: 7,
			Size:            128,
		},
	}, 1)
	if err != nil {
		t.Fatalf("expected valid video note attachment, got %v", err)
	}
	if len(attachments) != 1 {
		t.Fatalf("expected one attachment, got %d", len(attachments))
	}
	if attachments[0].FileType != "video_note" {
		t.Fatalf("expected video_note, got %q", attachments[0].FileType)
	}
	if attachments[0].FileURL != VideoNoteUploadKey(filename, 1) {
		t.Fatalf("unexpected object key %q", attachments[0].FileURL)
	}
	if attachments[0].DurationSeconds == nil || *attachments[0].DurationSeconds != 7 {
		t.Fatalf("unexpected duration %#v", attachments[0].DurationSeconds)
	}
}

func TestNormalizeVideoNoteRejectsMixedAttachments(t *testing.T) {
	defer storage.SetDefaultForTest(attachmentMockStorage{})()

	filename := "00000000-0000-4000-8000-000000000001.webm"
	_, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL(filename),
			FileType:        "video_note",
			DurationSeconds: 7,
			Size:            128,
		},
		{
			FileURL:  PrivateUploadURL("00000000-0000-4000-8000-000000000002.jpg"),
			FileType: "image",
			Width:    1,
			Height:   1,
			Size:     128,
		},
	}, 1)
	if err == nil || !strings.Contains(err.Error(), "cannot mix video note with other attachments") {
		t.Fatalf("expected mixed video note error, got %v", err)
	}

	_, err = NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL(filename),
			FileType:        "video_note",
			DurationSeconds: 7,
			Size:            128,
		},
		{
			FileURL:         PrivateUploadURL("00000000-0000-4000-8000-000000000003.ogg"),
			FileType:        "voice",
			DurationSeconds: 2,
			Size:            128,
		},
	}, 1)
	if err == nil || !strings.Contains(err.Error(), "cannot mix video note with other attachments") {
		t.Fatalf("expected mixed video note/voice error, got %v", err)
	}
}

func TestNormalizeVideoNoteRejectsMultipleVideoNotes(t *testing.T) {
	defer storage.SetDefaultForTest(attachmentMockStorage{})()

	_, err := NormalizeMessageAttachments([]MessageAttachmentInput{
		{
			FileURL:         PrivateUploadURL("00000000-0000-4000-8000-000000000001.webm"),
			FileType:        "video_note",
			DurationSeconds: 7,
			Size:            128,
		},
		{
			FileURL:         PrivateUploadURL("00000000-0000-4000-8000-000000000002.webm"),
			FileType:        "video_note",
			DurationSeconds: 7,
			Size:            128,
		},
	}, 1)
	if err == nil || !strings.Contains(err.Error(), "only one video note attachment is supported") {
		t.Fatalf("expected too many video notes error, got %v", err)
	}
}

func TestContentTypeForKeySupportsVideoNotes(t *testing.T) {
	tests := map[string]string{
		"video-notes/user_1/note.webm": "video/webm",
		"video-notes/user_1/note.mp4":  "video/mp4",
		"voice/user_1/note.webm":       "audio/webm",
	}

	for key, expected := range tests {
		if actual := ContentTypeForKey(key); actual != expected {
			t.Fatalf("ContentTypeForKey(%q) = %q, want %q", key, actual, expected)
		}
	}
}
