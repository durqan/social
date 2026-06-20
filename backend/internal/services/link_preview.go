package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"tester/internal/models"

	"gorm.io/gorm"
)

var (
	ErrUnsupportedVideoLink = errors.New("unsupported video link")
	ErrUnsafeVideoLink      = errors.New("unsafe video link")
	firstURLPattern         = regexp.MustCompile(`https?://[^\s<>"']+`)
	linkPreviewMetadataTTL  = 5 * time.Second
	ytDLPMetadataRunner     = runYTDLPMetadata
)

type LinkPreviewMetadata struct {
	Title           *string
	Description     *string
	ThumbnailURL    *string
	DurationSeconds *int
	CanonicalURL    string
}

func SetYTDLPMetadataRunnerForTest(runner func(context.Context, string) (LinkPreviewMetadata, error)) func() {
	previous := ytDLPMetadataRunner
	ytDLPMetadataRunner = runner
	return func() {
		ytDLPMetadataRunner = previous
	}
}

func FirstSupportedVideoLinkPreview(content string) (*models.MessageLinkPreview, bool) {
	for _, raw := range firstURLPattern.FindAllString(content, -1) {
		preview, err := BuildVideoLinkPreview(raw)
		if err == nil {
			return &preview, true
		}
	}
	return nil, false
}

func BuildVideoLinkPreview(raw string) (models.MessageLinkPreview, error) {
	cleanURL, provider, err := ParseSupportedVideoURL(raw)
	if err != nil {
		return models.MessageLinkPreview{}, err
	}

	return models.MessageLinkPreview{
		OriginalURL: cleanURL,
		Provider:    provider,
		Status:      models.LinkPreviewStatusPreview,
	}, nil
}

func EnrichMessageLinkPreviewAsync(db *gorm.DB, messageID uint, previewID uint) {
	if db == nil || messageID == 0 || previewID == 0 {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), linkPreviewMetadataTTL)
		defer cancel()

		var preview models.MessageLinkPreview
		if err := db.Where("id = ? AND message_id = ?", previewID, messageID).First(&preview).Error; err != nil {
			return
		}
		metadata, err := ResolveVideoLinkPreviewMetadata(ctx, preview.OriginalURL, preview.Provider)
		if err != nil || metadata.empty() {
			return
		}

		updates := map[string]any{}
		if metadata.Title != nil {
			updates["title"] = metadata.Title
		}
		if metadata.Description != nil {
			updates["description"] = metadata.Description
		}
		if metadata.ThumbnailURL != nil {
			updates["thumbnail_url"] = metadata.ThumbnailURL
		}
		if metadata.DurationSeconds != nil {
			updates["duration_seconds"] = metadata.DurationSeconds
		}
		if metadata.CanonicalURL != "" {
			updates["original_url"] = metadata.CanonicalURL
		}
		if len(updates) == 0 {
			return
		}

		if err := db.Model(&models.MessageLinkPreview{}).
			Where("id = ? AND message_id = ?", previewID, messageID).
			Updates(updates).Error; err != nil {
			return
		}
		PublishMessageUpdate(context.Background(), messageID)
	}()
}

func ResolveVideoLinkPreviewMetadata(ctx context.Context, raw string, provider string) (LinkPreviewMetadata, error) {
	if !IsSupportedVideoProvider(provider) {
		return LinkPreviewMetadata{}, ErrUnsupportedVideoLink
	}
	if _, parsedProvider, err := ParseSupportedVideoURL(raw); err != nil || parsedProvider != provider {
		if err != nil {
			return LinkPreviewMetadata{}, err
		}
		return LinkPreviewMetadata{}, ErrUnsupportedVideoLink
	}

	switch provider {
	case "youtube", "rutube":
		return ytDLPMetadataRunner(ctx, raw)
	case "instagram":
		metadata, err := ytDLPMetadataRunner(ctx, raw)
		if err != nil {
			return LinkPreviewMetadata{}, err
		}
		return metadata, nil
	default:
		return LinkPreviewMetadata{}, ErrUnsupportedVideoLink
	}
}

func runYTDLPMetadata(ctx context.Context, raw string) (LinkPreviewMetadata, error) {
	cmd := exec.CommandContext(ctx, "yt-dlp", "--dump-json", "--skip-download", "--no-playlist", raw)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return LinkPreviewMetadata{}, ctx.Err()
		}
		return LinkPreviewMetadata{}, errors.New(strings.TrimSpace(stderr.String()))
	}
	return parseYTDLPMetadata(output)
}

func parseYTDLPMetadata(output []byte) (LinkPreviewMetadata, error) {
	var payload struct {
		Title       string          `json:"title"`
		Description string          `json:"description"`
		Thumbnail   string          `json:"thumbnail"`
		Duration    json.RawMessage `json:"duration"`
		WebpageURL  string          `json:"webpage_url"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return LinkPreviewMetadata{}, err
	}

	var metadata LinkPreviewMetadata
	if title := nullablePreviewString(payload.Title, 300); title != nil {
		metadata.Title = title
	}
	if description := nullablePreviewString(payload.Description, 1000); description != nil {
		metadata.Description = description
	}
	if thumb := sanitizePreviewThumbnailURL(payload.Thumbnail); thumb != nil {
		metadata.ThumbnailURL = thumb
	}
	if duration := parsePreviewDuration(payload.Duration); duration != nil {
		metadata.DurationSeconds = duration
	}
	if canonical, _, err := ParseSupportedVideoURL(payload.WebpageURL); err == nil {
		metadata.CanonicalURL = canonical
	}
	return metadata, nil
}

func ParseSupportedVideoURL(raw string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), ".,);]}>"))
	if err != nil || parsed == nil || !parsed.IsAbs() {
		return "", "", ErrUnsupportedVideoLink
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", "", ErrUnsupportedVideoLink
	}
	if parsed.User != nil {
		return "", "", ErrUnsafeVideoLink
	}

	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "" || isUnsafeHost(host) {
		return "", "", ErrUnsafeVideoLink
	}

	provider, ok := supportedVideoProvider(host)
	if !ok {
		return "", "", ErrUnsupportedVideoLink
	}

	parsed.Fragment = ""
	return parsed.String(), provider, nil
}

func (metadata LinkPreviewMetadata) empty() bool {
	return metadata.Title == nil &&
		metadata.Description == nil &&
		metadata.ThumbnailURL == nil &&
		metadata.DurationSeconds == nil &&
		metadata.CanonicalURL == ""
}

func nullablePreviewString(value string, maxRunes int) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	runes := []rune(value)
	if len(runes) > maxRunes {
		value = string(runes[:maxRunes])
	}
	return &value
}

func sanitizePreviewThumbnailURL(raw string) *string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || !parsed.IsAbs() {
		return nil
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && isUnsafeIP(ip) {
		return nil
	}
	value := parsed.String()
	return &value
}

func parsePreviewDuration(raw json.RawMessage) *int {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil && number > 0 {
		seconds := int(number + 0.999)
		return &seconds
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		number, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err == nil && number > 0 {
			seconds := int(number + 0.999)
			return &seconds
		}
	}
	return nil
}

func supportedVideoProvider(host string) (string, bool) {
	switch {
	case host == "youtube.com" || strings.HasSuffix(host, ".youtube.com") || host == "youtu.be":
		return "youtube", true
	case host == "rutube.ru" || strings.HasSuffix(host, ".rutube.ru"):
		return "rutube", true
	case host == "instagram.com" || strings.HasSuffix(host, ".instagram.com"):
		return "instagram", true
	default:
		return "", false
	}
}

func IsSupportedVideoProvider(provider string) bool {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "youtube", "rutube", "instagram":
		return true
	default:
		return false
	}
}

func isUnsafeHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}

	if ip := net.ParseIP(host); ip != nil {
		return isUnsafeIP(ip)
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return true
	}
	if len(ips) == 0 {
		return true
	}
	for _, ip := range ips {
		if isUnsafeIP(ip) {
			return true
		}
	}
	return false
}

func isUnsafeIP(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() ||
		ip.IsMulticast()
}
