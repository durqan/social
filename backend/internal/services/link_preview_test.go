package services

import (
	"context"
	"errors"
	"testing"
)

func TestParseSupportedVideoURLProviders(t *testing.T) {
	tests := []struct {
		raw      string
		provider string
	}{
		{"https://www.youtube.com/watch?v=abc", "youtube"},
		{"https://youtu.be/abc", "youtube"},
		{"https://rutube.ru/video/abc/", "rutube"},
		{"https://www.instagram.com/reel/abc/", "instagram"},
	}

	for _, tt := range tests {
		_, provider, err := ParseSupportedVideoURL(tt.raw)
		if err != nil {
			t.Fatalf("ParseSupportedVideoURL(%q) returned error: %v", tt.raw, err)
		}
		if provider != tt.provider {
			t.Fatalf("provider = %q, want %q", provider, tt.provider)
		}
	}
}

func TestParseSupportedVideoURLRejectsUnsafeHosts(t *testing.T) {
	tests := []string{
		"file:///tmp/video.mp4",
		"ftp://youtube.com/video",
		"http://localhost/watch?v=1",
		"http://127.0.0.1/watch?v=1",
		"http://10.0.0.1/watch?v=1",
		"http://172.16.0.1/watch?v=1",
		"http://192.168.0.1/watch?v=1",
	}

	for _, raw := range tests {
		if _, _, err := ParseSupportedVideoURL(raw); err == nil {
			t.Fatalf("ParseSupportedVideoURL(%q) returned nil error", raw)
		}
	}
}

func TestBuildVideoLinkPreviewRejectsUnsupportedProvider(t *testing.T) {
	_, err := BuildVideoLinkPreview("https://example.com/video")
	if !errors.Is(err, ErrUnsupportedVideoLink) {
		t.Fatalf("err = %v, want ErrUnsupportedVideoLink", err)
	}
}

func TestResolveVideoLinkPreviewMetadataFillsTitleThumbnailAndDuration(t *testing.T) {
	restore := SetYTDLPMetadataRunnerForTest(func(ctx context.Context, raw string) (LinkPreviewMetadata, error) {
		return parseYTDLPMetadata([]byte(`{
			"title":"Example video",
			"thumbnail":"https://i.ytimg.com/vi/abc/hqdefault.jpg",
			"duration":123.2,
			"webpage_url":"https://www.youtube.com/watch?v=abc"
		}`))
	})
	defer restore()

	metadata, err := ResolveVideoLinkPreviewMetadata(context.Background(), "https://youtu.be/abc", "youtube")
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Title == nil || *metadata.Title != "Example video" {
		t.Fatalf("title = %v, want Example video", metadata.Title)
	}
	if metadata.ThumbnailURL == nil || *metadata.ThumbnailURL != "https://i.ytimg.com/vi/abc/hqdefault.jpg" {
		t.Fatalf("thumbnail = %v", metadata.ThumbnailURL)
	}
	if metadata.DurationSeconds == nil || *metadata.DurationSeconds != 124 {
		t.Fatalf("duration = %v, want 124", metadata.DurationSeconds)
	}
	if metadata.CanonicalURL != "https://www.youtube.com/watch?v=abc" {
		t.Fatalf("canonical url = %q", metadata.CanonicalURL)
	}
}

func TestResolveVideoLinkPreviewMetadataFailureReturnsError(t *testing.T) {
	restore := SetYTDLPMetadataRunnerForTest(func(ctx context.Context, raw string) (LinkPreviewMetadata, error) {
		return LinkPreviewMetadata{}, errors.New("yt-dlp failed")
	})
	defer restore()

	_, err := ResolveVideoLinkPreviewMetadata(context.Background(), "https://youtu.be/abc", "youtube")
	if err == nil {
		t.Fatal("expected resolver error")
	}
}
