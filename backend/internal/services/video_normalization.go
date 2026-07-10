package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	NormalizedVideoContentType       = "video/mp4"
	defaultChatVideoTempRoot         = "/tmp/chat-video-normalization"
	defaultChatVideoNormalizeTimeout = 20 * time.Minute
	chatVideoMaxLongSide             = 1920
	chatVideoMaxShortSide            = 1080
)

type VideoNormalizationError struct {
	Stage        string
	InvalidInput bool
	Err          error
}

func (e *VideoNormalizationError) Error() string {
	return fmt.Sprintf("video normalization %s failed: %v", e.Stage, e.Err)
}

func (e *VideoNormalizationError) Unwrap() error {
	return e.Err
}

func IsVideoNormalizationInputError(err error) bool {
	var normalizationError *VideoNormalizationError
	return errors.As(err, &normalizationError) && normalizationError.InvalidInput
}

type NormalizedVideo struct {
	File              *os.File
	Width             int
	Height            int
	DurationSeconds   int
	Size              int64
	Mode              string
	SourceVideoCodec  string
	SourceAudioCodec  string
	SourcePixelFormat string
	tempDir           string
}

func (video *NormalizedVideo) Close() error {
	if video == nil {
		return nil
	}

	var closeErr error
	if video.File != nil {
		closeErr = video.File.Close()
		video.File = nil
	}
	if video.tempDir != "" {
		if err := os.RemoveAll(video.tempDir); closeErr == nil {
			closeErr = err
		}
		video.tempDir = ""
	}
	return closeErr
}

type normalizedVideoProbe struct {
	FormatName      string
	VideoCodec      string
	AudioCodec      string
	PixelFormat     string
	Profile         string
	Level           int
	Width           int
	Height          int
	FramesPerSecond float64
	DurationSeconds int
	Size            int64
}

var (
	chatVideoSlotsOnce sync.Once
	chatVideoSlots     chan struct{}
)

func NormalizeUploadedVideo(ctx context.Context, source io.ReadSeeker, maxOutputBytes int64) (*NormalizedVideo, error) {
	if source == nil {
		return nil, &VideoNormalizationError{Stage: "input", InvalidInput: true, Err: errors.New("video is empty")}
	}
	if err := acquireChatVideoSlot(ctx); err != nil {
		return nil, &VideoNormalizationError{Stage: "queue", Err: err}
	}
	defer releaseChatVideoSlot()

	root := strings.TrimSpace(os.Getenv("CHAT_VIDEO_TEMP_ROOT"))
	if root == "" {
		root = defaultChatVideoTempRoot
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, &VideoNormalizationError{Stage: "temp-root", Err: err}
	}
	tempDir, err := os.MkdirTemp(root, "upload-")
	if err != nil {
		return nil, &VideoNormalizationError{Stage: "temp-dir", Err: err}
	}
	keepTemp := false
	defer func() {
		if !keepTemp {
			_ = os.RemoveAll(tempDir)
		}
	}()

	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return nil, &VideoNormalizationError{Stage: "input-seek", InvalidInput: true, Err: err}
	}
	inputPath := filepath.Join(tempDir, "input.media")
	inputFile, err := os.OpenFile(inputPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, &VideoNormalizationError{Stage: "input-create", Err: err}
	}
	_, copyErr := io.Copy(inputFile, source)
	closeErr := inputFile.Close()
	if copyErr != nil {
		return nil, &VideoNormalizationError{Stage: "input-copy", Err: copyErr}
	}
	if closeErr != nil {
		return nil, &VideoNormalizationError{Stage: "input-close", Err: closeErr}
	}

	sourceProbe, err := probeNormalizedVideo(ctx, inputPath)
	if err != nil {
		return nil, classifyVideoToolError("probe-input", err, true)
	}

	outputPath := filepath.Join(tempDir, "normalized.mp4")
	mode := "transcode"
	if sourceProbe.androidCompatible() {
		mode = "remux"
		err = runCommand(
			ctx,
			chatVideoNormalizeTimeout(),
			"ffmpeg",
			"-nostdin",
			"-hide_banner",
			"-loglevel", "error",
			"-y",
			"-i", inputPath,
			"-map", "0:v:0",
			"-map", "0:a:0?",
			"-map_metadata", "-1",
			"-sn",
			"-dn",
			"-c", "copy",
			"-movflags", "+faststart",
			"-f", "mp4",
			outputPath,
		)
	}
	if mode == "transcode" || err != nil {
		mode = "transcode"
		err = runCommand(
			ctx,
			chatVideoNormalizeTimeout(),
			"ffmpeg",
			"-nostdin",
			"-hide_banner",
			"-loglevel", "error",
			"-y",
			"-i", inputPath,
			"-map", "0:v:0",
			"-map", "0:a:0?",
			"-map_metadata", "-1",
			"-sn",
			"-dn",
			"-vf", compatibleVideoFilter(chatVideoMaxLongSide, chatVideoMaxShortSide),
			"-c:v", "libx264",
			"-preset", "veryfast",
			"-crf", "23",
			"-pix_fmt", "yuv420p",
			"-profile:v", "main",
			"-level:v", "4.0",
			"-tag:v", "avc1",
			"-g", "60",
			"-c:a", "aac",
			"-b:a", "128k",
			"-ac", "2",
			"-ar", "48000",
			"-max_muxing_queue_size", "1024",
			"-movflags", "+faststart",
			"-f", "mp4",
			outputPath,
		)
	}
	if err != nil {
		return nil, classifyVideoToolError("ffmpeg", err, true)
	}

	outputProbe, err := probeNormalizedVideo(ctx, outputPath)
	if err != nil {
		return nil, classifyVideoToolError("probe-output", err, false)
	}
	if !outputProbe.androidCompatible() || !strings.Contains(strings.ToLower(outputProbe.FormatName), "mp4") {
		return nil, &VideoNormalizationError{
			Stage: "verify-output",
			Err: fmt.Errorf(
				"unexpected output format=%s video=%s audio=%s pix_fmt=%s profile=%s level=%d fps=%.2f",
				outputProbe.FormatName,
				outputProbe.VideoCodec,
				outputProbe.AudioCodec,
				outputProbe.PixelFormat,
				outputProbe.Profile,
				outputProbe.Level,
				outputProbe.FramesPerSecond,
			),
		}
	}
	if maxOutputBytes > 0 && outputProbe.Size > maxOutputBytes {
		return nil, &VideoNormalizationError{
			Stage:        "verify-size",
			InvalidInput: true,
			Err:          fmt.Errorf("normalized video is too large: %d bytes", outputProbe.Size),
		}
	}

	outputFile, err := os.Open(outputPath)
	if err != nil {
		return nil, &VideoNormalizationError{Stage: "open-output", Err: err}
	}
	keepTemp = true
	return &NormalizedVideo{
		File:              outputFile,
		Width:             outputProbe.Width,
		Height:            outputProbe.Height,
		DurationSeconds:   outputProbe.DurationSeconds,
		Size:              outputProbe.Size,
		Mode:              mode,
		SourceVideoCodec:  sourceProbe.VideoCodec,
		SourceAudioCodec:  sourceProbe.AudioCodec,
		SourcePixelFormat: sourceProbe.PixelFormat,
		tempDir:           tempDir,
	}, nil
}

func NormalizedVideoFilename(filename string) string {
	raw := filepath.Base(strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/")))
	base := strings.TrimSuffix(raw, filepath.Ext(raw))
	return SanitizeAttachmentFilename(base+".mp4", ".mp4")
}

func compatibleVideoFilter(maxLongSide int, maxShortSide int) string {
	return fmt.Sprintf(
		"scale=w='if(gte(iw,ih),min(iw,%d),min(iw,%d))':h='if(gte(iw,ih),min(ih,%d),min(ih,%d))':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=fps='min(source_fps,30)':round=near,format=yuv420p",
		maxLongSide,
		maxShortSide,
		maxShortSide,
		maxLongSide,
	)
}

func probeNormalizedVideo(ctx context.Context, path string) (normalizedVideoProbe, error) {
	info, err := os.Stat(path)
	if err != nil {
		return normalizedVideoProbe{}, err
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(
		cmdCtx,
		"ffprobe",
		"-v", "error",
		"-show_entries", "format=format_name,duration:stream=codec_type,codec_name,profile,pix_fmt,level,width,height,avg_frame_rate,r_frame_rate,duration",
		"-of", "json",
		path,
	)
	output, err := cmd.Output()
	if err != nil {
		if cmdCtx.Err() != nil {
			return normalizedVideoProbe{}, cmdCtx.Err()
		}
		return normalizedVideoProbe{}, err
	}

	var parsed struct {
		Format struct {
			FormatName string `json:"format_name"`
			Duration   string `json:"duration"`
		} `json:"format"`
		Streams []struct {
			CodecType   string `json:"codec_type"`
			CodecName   string `json:"codec_name"`
			Profile     string `json:"profile"`
			PixelFormat string `json:"pix_fmt"`
			Level       int    `json:"level"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
			AverageRate string `json:"avg_frame_rate"`
			RealRate    string `json:"r_frame_rate"`
			Duration    string `json:"duration"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &parsed); err != nil {
		return normalizedVideoProbe{}, err
	}

	result := normalizedVideoProbe{
		FormatName: parsed.Format.FormatName,
		Size:       info.Size(),
	}
	duration := parseFFprobeFloat(parsed.Format.Duration)
	for _, stream := range parsed.Streams {
		switch stream.CodecType {
		case "video":
			if result.VideoCodec != "" {
				continue
			}
			result.VideoCodec = strings.ToLower(stream.CodecName)
			result.PixelFormat = strings.ToLower(stream.PixelFormat)
			result.Profile = strings.ToLower(strings.TrimSpace(stream.Profile))
			result.Level = stream.Level
			result.Width = stream.Width
			result.Height = stream.Height
			result.FramesPerSecond = parseFrameRate(stream.AverageRate)
			if result.FramesPerSecond <= 0 {
				result.FramesPerSecond = parseFrameRate(stream.RealRate)
			}
			if streamDuration := parseFFprobeFloat(stream.Duration); streamDuration > 0 {
				duration = streamDuration
			}
		case "audio":
			if result.AudioCodec == "" {
				result.AudioCodec = strings.ToLower(stream.CodecName)
			}
		}
	}
	if result.VideoCodec == "" || result.Width <= 0 || result.Height <= 0 {
		return normalizedVideoProbe{}, errors.New("video stream not found")
	}
	if duration <= 0 {
		return normalizedVideoProbe{}, errors.New("video duration is unavailable")
	}
	result.DurationSeconds = int(math.Ceil(duration))
	return result, nil
}

func (probe normalizedVideoProbe) androidCompatible() bool {
	if probe.VideoCodec != "h264" || probe.PixelFormat != "yuv420p" {
		return false
	}
	if probe.AudioCodec != "" && probe.AudioCodec != "aac" {
		return false
	}
	if probe.Level <= 0 || probe.Level > 40 {
		return false
	}
	switch probe.Profile {
	case "baseline", "constrained baseline", "main":
	default:
		return false
	}
	if probe.Width <= 0 || probe.Height <= 0 || probe.Width%2 != 0 || probe.Height%2 != 0 {
		return false
	}
	longSide, shortSide := probe.Width, probe.Height
	if shortSide > longSide {
		longSide, shortSide = shortSide, longSide
	}
	if longSide > chatVideoMaxLongSide || shortSide > chatVideoMaxShortSide {
		return false
	}
	return probe.FramesPerSecond > 0 && probe.FramesPerSecond <= 30.5
}

func parseFrameRate(value string) float64 {
	parts := strings.Split(strings.TrimSpace(value), "/")
	if len(parts) == 2 {
		numerator := parseFFprobeFloat(parts[0])
		denominator := parseFFprobeFloat(parts[1])
		if denominator > 0 {
			return numerator / denominator
		}
	}
	return parseFFprobeFloat(value)
}

func parseFFprobeFloat(value string) float64 {
	parsed, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0
	}
	return parsed
}

func classifyVideoToolError(stage string, err error, invalidInput bool) error {
	if errors.Is(err, exec.ErrNotFound) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		invalidInput = false
	}
	return &VideoNormalizationError{Stage: stage, InvalidInput: invalidInput, Err: err}
}

func acquireChatVideoSlot(ctx context.Context) error {
	chatVideoSlotsOnce.Do(func() {
		concurrency := 1
		if raw := strings.TrimSpace(os.Getenv("CHAT_VIDEO_NORMALIZATION_CONCURRENCY")); raw != "" {
			if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
				concurrency = parsed
			}
		}
		chatVideoSlots = make(chan struct{}, concurrency)
	})

	select {
	case chatVideoSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func releaseChatVideoSlot() {
	<-chatVideoSlots
}

func chatVideoNormalizeTimeout() time.Duration {
	raw := strings.TrimSpace(os.Getenv("CHAT_VIDEO_NORMALIZATION_TIMEOUT"))
	if raw == "" {
		return defaultChatVideoNormalizeTimeout
	}
	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return defaultChatVideoNormalizeTimeout
	}
	return parsed
}
