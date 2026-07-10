package services

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestNormalizedVideoProbeAndroidCompatibility(t *testing.T) {
	compatible := normalizedVideoProbe{
		FormatName:      "mov,mp4,m4a,3gp,3g2,mj2",
		VideoCodec:      "h264",
		AudioCodec:      "aac",
		PixelFormat:     "yuv420p",
		Profile:         "main",
		Level:           40,
		Width:           1280,
		Height:          720,
		FramesPerSecond: 30,
		DurationSeconds: 5,
		Size:            1024,
	}
	if !compatible.androidCompatible() {
		t.Fatal("expected AVC/yuv420p/AAC probe to be compatible")
	}

	tests := []struct {
		name   string
		mutate func(*normalizedVideoProbe)
	}{
		{"hevc", func(probe *normalizedVideoProbe) { probe.VideoCodec = "hevc" }},
		{"ten bit", func(probe *normalizedVideoProbe) { probe.PixelFormat = "yuv420p10le" }},
		{"opus audio", func(probe *normalizedVideoProbe) { probe.AudioCodec = "opus" }},
		{"high profile", func(probe *normalizedVideoProbe) { probe.Profile = "high" }},
		{"level above 4", func(probe *normalizedVideoProbe) { probe.Level = 51 }},
		{"4k", func(probe *normalizedVideoProbe) { probe.Width = 3840; probe.Height = 2160 }},
		{"60 fps", func(probe *normalizedVideoProbe) { probe.FramesPerSecond = 60 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			probe := compatible
			tt.mutate(&probe)
			if probe.androidCompatible() {
				t.Fatalf("expected %s probe to require transcoding", tt.name)
			}
		})
	}
}

func TestNormalizedVideoFilename(t *testing.T) {
	if got := NormalizedVideoFilename("Camera HEVC.MOV"); got != "Camera HEVC.mp4" {
		t.Fatalf("NormalizedVideoFilename() = %q, want %q", got, "Camera HEVC.mp4")
	}
}

func TestParseFrameRate(t *testing.T) {
	if got := parseFrameRate("30000/1001"); got < 29.96 || got > 29.98 {
		t.Fatalf("parseFrameRate() = %f, want approximately 29.97", got)
	}
}

func TestNormalizeUploadedVideoTranscodesToAndroidCompatibleMP4(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe is not installed")
	}

	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "source.avi")
	command := exec.Command(
		"ffmpeg",
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-y",
		"-f", "lavfi",
		"-i", "testsrc=size=320x240:rate=25",
		"-t", "1",
		"-c:v", "mpeg4",
		"-q:v", "5",
		inputPath,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("create incompatible fixture: %v: %s", err, output)
	}

	input, err := os.Open(inputPath)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer input.Close()

	normalized, err := NormalizeUploadedVideo(context.Background(), input, 10<<20)
	if err != nil {
		t.Fatalf("NormalizeUploadedVideo(): %v", err)
	}
	defer normalized.Close()
	if normalized.Mode != "transcode" {
		t.Fatalf("normalization mode = %q, want transcode", normalized.Mode)
	}

	probe, err := probeNormalizedVideo(context.Background(), normalized.File.Name())
	if err != nil {
		t.Fatalf("probe normalized output: %v", err)
	}
	if !probe.androidCompatible() {
		t.Fatalf("normalized output is not Android-compatible: %+v", probe)
	}
	if probe.VideoCodec != "h264" || probe.PixelFormat != "yuv420p" {
		t.Fatalf("normalized video=%s pix_fmt=%s, want h264/yuv420p", probe.VideoCodec, probe.PixelFormat)
	}
	if probe.AudioCodec != "" && probe.AudioCodec != "aac" {
		t.Fatalf("normalized audio codec = %s, want AAC or no audio", probe.AudioCodec)
	}
}
