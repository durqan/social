package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tester/internal/models"
	"tester/internal/rabbit"
	"tester/internal/storage"

	amqp "github.com/rabbitmq/amqp091-go"
	"gorm.io/gorm"
)

const (
	defaultVideoImportTempRoot       = "/tmp/video-imports"
	defaultVideoImportDownloadTimout = 20 * time.Minute
	defaultVideoImportFFmpegTimeout  = 30 * time.Minute

	maxFastCopySourceSizeBytes = 150 * 1024 * 1024
	maxFastCopyLongSide        = 1280
	maxFastCopyShortSide       = 720
)

type VideoImportWorkerConfig struct {
	RabbitURL     string
	Concurrency   int
	TempRoot      string
	DownloadLimit time.Duration
	FFmpegLimit   time.Duration
}

type videoMetadata struct {
	DurationSeconds int
	Width           int
	Height          int
	SizeBytes       int64
}

type sourceVideoInfo struct {
	VideoCodec      string
	AudioCodec      string
	PixelFormat     string
	Profile         string
	Level           int
	FramesPerSecond float64
	Width           int
	Height          int
	SizeBytes       int64
}

func RunVideoImportWorker(ctx context.Context, db *gorm.DB, cfg VideoImportWorkerConfig) error {
	if cfg.RabbitURL == "" {
		return rabbit.ErrNotConfigured
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 1
	}
	if cfg.TempRoot == "" {
		cfg.TempRoot = defaultVideoImportTempRoot
	}
	if cfg.DownloadLimit <= 0 {
		cfg.DownloadLimit = defaultVideoImportDownloadTimout
	}
	if cfg.FFmpegLimit <= 0 {
		cfg.FFmpegLimit = defaultVideoImportFFmpegTimeout
	}
	if err := cleanupOldVideoImportTemps(cfg.TempRoot); err != nil {
		log.Printf("failed to cleanup old video import temp files: %v", err)
	}

	conn, err := amqp.Dial(cfg.RabbitURL)
	if err != nil {
		return err
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		return err
	}
	defer ch.Close()

	if _, err := ch.QueueDeclare(rabbit.VideoImportsQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.Qos(cfg.Concurrency, 0, false); err != nil {
		return err
	}

	deliveries, err := ch.Consume(rabbit.VideoImportsQueue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}

	sem := make(chan struct{}, cfg.Concurrency)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case delivery, ok := <-deliveries:
			if !ok {
				return errors.New("video import queue closed")
			}
			sem <- struct{}{}
			go func(d amqp.Delivery) {
				defer func() { <-sem }()
				if err := handleVideoImportDelivery(ctx, db, cfg, d); err != nil {
					log.Printf("video import job failed: %v", err)
				}
			}(delivery)
		}
	}
}

func handleVideoImportDelivery(ctx context.Context, db *gorm.DB, cfg VideoImportWorkerConfig, delivery amqp.Delivery) error {
	var job VideoImportJob
	if err := json.Unmarshal(delivery.Body, &job); err != nil {
		_ = delivery.Ack(false)
		return err
	}

	if err := ProcessVideoImportJob(ctx, db, cfg, job); err != nil {
		_ = delivery.Ack(false)
		return err
	}
	return delivery.Ack(false)
}

func buildYTDLPDownloadArgs(sourceTemplate string, originalURL string) []string {
	args := []string{
		"-f", "bv*[ext=mp4][vcodec^=avc1][height<=1280]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][vcodec^=avc1][height<=1280]/bv*[vcodec^=avc1][height<=1280]+ba/b[height<=1280]/best[height<=1280]/best",
		"--merge-output-format", "mp4",
		"--no-playlist",
		"--socket-timeout", "60",
		"--retries", "2",
		"--fragment-retries", "2",
	}
	args = appendYTDLPNetworkArgs(args)
	args = append(args, "-o", sourceTemplate, originalURL)

	return args
}

func classifyVideoDownloadError(err error) string {
	if err == nil {
		return "Не удалось скачать видео"
	}

	text := strings.ToLower(err.Error())

	switch {
	case strings.Contains(text, "this content isn't available to everyone"),
		strings.Contains(text, "content isn't available"),
		strings.Contains(text, "not available"),
		strings.Contains(text, "login required"),
		strings.Contains(text, "private"):
		return "Видео недоступно публично или ограничено настройками Instagram"
	case strings.Contains(text, "timed out"),
		strings.Contains(text, "network unreachable"),
		strings.Contains(text, "connection refused"),
		strings.Contains(text, "handshake operation timed out"):
		return "Не удалось подключиться к источнику видео"
	default:
		return "Не удалось скачать видео"
	}
}

func ProcessVideoImportJob(ctx context.Context, db *gorm.DB, cfg VideoImportWorkerConfig, job VideoImportJob) error {
	tempDir := filepath.Join(defaultString(cfg.TempRoot, defaultVideoImportTempRoot), job.JobID)
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return err
	}
	defer os.RemoveAll(tempDir)

	if _, _, err := ParseSupportedVideoURL(job.OriginalURL); err != nil {
		return failVideoImport(ctx, db, job, "Небезопасная или неподдерживаемая ссылка", err)
	}

	log.Printf("video import %s: started message_id=%d preview_id=%d provider=%s", job.JobID, job.MessageID, job.LinkPreviewID, job.Provider)

	sourceTemplate := filepath.Join(tempDir, "source.%(ext)s")

	log.Printf("video import %s: downloading source", job.JobID)

	ytDLPArgs := buildYTDLPDownloadArgs(sourceTemplate, job.OriginalURL)

	if err := runCommand(
		ctx,
		cfg.DownloadLimit,
		"yt-dlp",
		ytDLPArgs...,
	); err != nil {
		return failVideoImport(ctx, db, job, classifyVideoDownloadError(err), err)
	}

	sourcePath, err := findDownloadedSource(tempDir)
	if err != nil {
		return failVideoImport(ctx, db, job, "Не удалось скачать видео", err)
	}
	log.Printf("video import %s: downloaded source=%s", job.JobID, sourcePath)

	sourceInfo, err := probeSourceVideoInfo(ctx, sourcePath)
	if err != nil {
		log.Printf("video import %s: could not probe source, will transcode: %v", job.JobID, err)
	} else {
		log.Printf(
			"video import %s: source info video=%s audio=%s pix_fmt=%s profile=%s level=%d fps=%.2f size=%d width=%d height=%d",
			job.JobID,
			sourceInfo.VideoCodec,
			sourceInfo.AudioCodec,
			sourceInfo.PixelFormat,
			sourceInfo.Profile,
			sourceInfo.Level,
			sourceInfo.FramesPerSecond,
			sourceInfo.SizeBytes,
			sourceInfo.Width,
			sourceInfo.Height,
		)
	}

	processedPath := filepath.Join(tempDir, "processed.mp4")
	thumbPath := filepath.Join(tempDir, "thumb.jpg")

	transcodeVideo := func() error {
		log.Printf("video import %s: transcoding video", job.JobID)
		if err := runCommand(
			ctx,
			cfg.FFmpegLimit,
			"ffmpeg",
			"-nostdin",
			"-hide_banner",
			"-loglevel", "error",
			"-y",
			"-i", sourcePath,
			"-map", "0:v:0",
			"-map", "0:a:0?",
			"-map_metadata", "-1",
			"-sn",
			"-dn",
			"-vf", compatibleVideoFilter(1280, 720),
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
			processedPath,
		); err != nil {
			return err
		}
		log.Printf("video import %s: transcoded processed=%s", job.JobID, processedPath)
		return nil
	}

	if sourceInfo.canFastCopy() {
		log.Printf("video import %s: remuxing video without transcode", job.JobID)
		if err := runCommand(
			ctx,
			5*time.Minute,
			"ffmpeg",
			"-nostdin",
			"-hide_banner",
			"-loglevel", "error",
			"-y",
			"-i", sourcePath,
			"-map", "0:v:0",
			"-map", "0:a:0?",
			"-map_metadata", "-1",
			"-sn",
			"-dn",
			"-c", "copy",
			"-movflags", "+faststart",
			"-f", "mp4",
			processedPath,
		); err != nil {
			log.Printf("video import %s: remux failed, falling back to transcode: %v", job.JobID, err)
			if err := transcodeVideo(); err != nil {
				return failVideoImport(ctx, db, job, "Не удалось обработать видео", err)
			}
		} else {
			log.Printf("video import %s: remuxed processed=%s", job.JobID, processedPath)
		}
	} else {
		if err := transcodeVideo(); err != nil {
			return failVideoImport(ctx, db, job, "Не удалось обработать видео", err)
		}
	}

	log.Printf("video import %s: creating thumbnail", job.JobID)
	if err := runCommand(
		ctx,
		2*time.Minute,
		"ffmpeg",
		"-y",
		"-ss", "00:00:01",
		"-i", processedPath,
		"-frames:v", "1",
		"-q:v", "3",
		thumbPath,
	); err != nil {
		return failVideoImport(ctx, db, job, "Не удалось создать обложку", err)
	}

	log.Printf("video import %s: probing metadata", job.JobID)
	metadata, err := probeVideoMetadata(ctx, processedPath)
	if err != nil {
		return failVideoImport(ctx, db, job, "Не удалось прочитать параметры видео", err)
	}

	store, err := storage.Default()
	if err != nil {
		return failVideoImport(ctx, db, job, "Не удалось подготовить хранилище", err)
	}

	var attachmentID uint
	err = db.Transaction(func(tx *gorm.DB) error {
		var message models.Message
		if err := tx.Where("id = ?", job.MessageID).First(&message).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		attachment := models.MessageAttachment{
			MessageID:         job.MessageID,
			FileURL:           fmt.Sprintf("chat-videos/%d/pending.mp4", job.MessageID),
			ThumbnailURL:      fmt.Sprintf("chat-video-thumbnails/%d/pending.jpg", job.MessageID),
			FileType:          "video",
			OriginalFilename:  "imported-video.mp4",
			ContentType:       "video/mp4",
			Width:             intPtr(metadata.Width),
			Height:            intPtr(metadata.Height),
			DurationSeconds:   intPtr(metadata.DurationSeconds),
			Size:              metadata.SizeBytes,
			EncryptionVersion: 0,
		}
		if err := tx.Create(&attachment).Error; err != nil {
			return err
		}
		attachmentID = attachment.ID
		return nil
	})
	if err != nil {
		return failVideoImport(ctx, db, job, "Не удалось сохранить видео", err)
	}
	if attachmentID == 0 {
		return nil
	}

	videoKey := fmt.Sprintf("chat-videos/%d/%d.mp4", job.MessageID, attachmentID)
	thumbKey := fmt.Sprintf("chat-video-thumbnails/%d/%d.jpg", job.MessageID, attachmentID)

	log.Printf("video import %s: uploading video key=%s", job.JobID, videoKey)
	if err := uploadFile(ctx, store, videoKey, processedPath, "video/mp4"); err != nil {
		_ = db.Delete(&models.MessageAttachment{}, attachmentID).Error
		return failVideoImport(ctx, db, job, "Не удалось загрузить видео", err)
	}

	log.Printf("video import %s: uploading thumbnail key=%s", job.JobID, thumbKey)
	if err := uploadFile(ctx, store, thumbKey, thumbPath, "image/jpeg"); err != nil {
		_ = db.Delete(&models.MessageAttachment{}, attachmentID).Error
		return failVideoImport(ctx, db, job, "Не удалось загрузить обложку", err)
	}

	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.MessageAttachment{}).Where("id = ?", attachmentID).Updates(map[string]any{
			"file_url":      videoKey,
			"thumbnail_url": thumbKey,
		}).Error; err != nil {
			return err
		}
		return tx.Model(&models.MessageLinkPreview{}).
			Where("id = ? AND message_id = ?", job.LinkPreviewID, job.MessageID).
			Updates(map[string]any{
				"status":              models.LinkPreviewStatusReady,
				"import_error":        nil,
				"video_attachment_id": attachmentID,
			}).Error
	}); err != nil {
		return failVideoImport(ctx, db, job, "Не удалось сохранить видео", err)
	}

	log.Printf("video import %s: completed message_id=%d attachment_id=%d", job.JobID, job.MessageID, attachmentID)

	PublishMessageUpdate(ctx, job.MessageID)
	return nil
}

func failVideoImport(ctx context.Context, db *gorm.DB, job VideoImportJob, message string, cause error) error {
	short := message
	if cause != nil {
		log.Printf("video import %s failed: %v", job.JobID, cause)
	}
	_ = db.Model(&models.MessageLinkPreview{}).
		Where("id = ? AND message_id = ?", job.LinkPreviewID, job.MessageID).
		Updates(map[string]any{
			"status":       models.LinkPreviewStatusFailed,
			"import_error": short,
		}).Error
	PublishMessageUpdate(ctx, job.MessageID)
	return cause
}

func runCommand(ctx context.Context, timeout time.Duration, name string, args ...string) error {
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, name, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if cmdCtx.Err() != nil {
			return cmdCtx.Err()
		}
		return fmt.Errorf("%s failed: %w: %s", name, err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func findDownloadedSource(tempDir string) (string, error) {
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "source.") {
			continue
		}
		return filepath.Join(tempDir, entry.Name()), nil
	}
	return "", errors.New("downloaded source not found")
}

func probeSourceVideoInfo(ctx context.Context, path string) (sourceVideoInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return sourceVideoInfo{}, err
	}

	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(
		cmdCtx,
		"ffprobe",
		"-v", "error",
		"-show_entries", "stream=index,codec_type,codec_name,profile,pix_fmt,level,width,height,avg_frame_rate,r_frame_rate",
		"-of", "json",
		path,
	)

	output, err := cmd.Output()
	if err != nil {
		return sourceVideoInfo{}, err
	}

	var parsed struct {
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
		} `json:"streams"`
	}

	if err := json.Unmarshal(output, &parsed); err != nil {
		return sourceVideoInfo{}, err
	}

	var result sourceVideoInfo
	result.SizeBytes = info.Size()

	for _, stream := range parsed.Streams {
		switch stream.CodecType {
		case "video":
			if result.VideoCodec == "" {
				result.VideoCodec = strings.ToLower(stream.CodecName)
				result.PixelFormat = strings.ToLower(stream.PixelFormat)
				result.Profile = strings.ToLower(strings.TrimSpace(stream.Profile))
				result.Level = stream.Level
				result.FramesPerSecond = parseFrameRate(stream.AverageRate)
				if result.FramesPerSecond <= 0 {
					result.FramesPerSecond = parseFrameRate(stream.RealRate)
				}
				result.Width = stream.Width
				result.Height = stream.Height
			}
		case "audio":
			if result.AudioCodec == "" {
				result.AudioCodec = strings.ToLower(stream.CodecName)
			}
		}
	}

	if result.VideoCodec == "" {
		return sourceVideoInfo{}, errors.New("video stream not found")
	}

	return result, nil
}

func (info sourceVideoInfo) canFastCopy() bool {
	if info.VideoCodec != "h264" {
		return false
	}
	if info.AudioCodec != "" && info.AudioCodec != "aac" {
		return false
	}
	if info.PixelFormat != "yuv420p" || info.Level <= 0 || info.Level > 40 || info.FramesPerSecond <= 0 || info.FramesPerSecond > 30.5 {
		return false
	}
	switch info.Profile {
	case "baseline", "constrained baseline", "main":
	default:
		return false
	}
	if info.SizeBytes <= 0 || info.SizeBytes > maxFastCopySourceSizeBytes {
		return false
	}

	longSide := info.Width
	shortSide := info.Height
	if shortSide > longSide {
		longSide, shortSide = shortSide, longSide
	}

	return longSide <= maxFastCopyLongSide && shortSide <= maxFastCopyShortSide
}

func probeVideoMetadata(ctx context.Context, path string) (videoMetadata, error) {
	info, err := os.Stat(path)
	if err != nil {
		return videoMetadata{}, err
	}
	cmdCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cmdCtx, "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration", "-of", "json", path)
	output, err := cmd.Output()
	if err != nil {
		return videoMetadata{}, err
	}

	var parsed struct {
		Streams []struct {
			Width    int    `json:"width"`
			Height   int    `json:"height"`
			Duration string `json:"duration"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(output, &parsed); err != nil {
		return videoMetadata{}, err
	}
	if len(parsed.Streams) == 0 {
		return videoMetadata{}, errors.New("video stream not found")
	}
	durationFloat, _ := strconv.ParseFloat(parsed.Streams[0].Duration, 64)
	duration := int(durationFloat + 0.999)
	if duration < 1 {
		duration = 1
	}
	return videoMetadata{
		DurationSeconds: duration,
		Width:           parsed.Streams[0].Width,
		Height:          parsed.Streams[0].Height,
		SizeBytes:       info.Size(),
	}, nil
}

func uploadFile(ctx context.Context, store storage.Storage, key string, path string, contentType string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return store.Upload(ctx, key, file, contentType)
}

func cleanupOldVideoImportTemps(root string) error {
	if root == "" {
		root = defaultVideoImportTempRoot
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
	return nil
}

func intPtr(value int) *int {
	if value <= 0 {
		return nil
	}
	return &value
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
