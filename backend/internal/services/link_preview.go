package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"tester/internal/models"
	"tester/internal/storage"

	"gorm.io/gorm"
)

var (
	ErrUnsupportedVideoLink = errors.New("unsupported video link")
	ErrUnsafeVideoLink      = errors.New("unsafe video link")
	firstURLPattern         = regexp.MustCompile(`https?://[^\s<>"']+`)
	linkPreviewMetadataTTL  = 45 * time.Second
	ytDLPMetadataRunner     = runYTDLPMetadata
	linkPreviewImageFetcher = fetchLinkPreviewImage
)

const linkPreviewImageMaxSize = 5 << 20

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
		if err != nil {
			log.Printf(
				"link preview metadata failed: message_id=%d preview_id=%d provider=%s error=%v",
				messageID,
				previewID,
				preview.Provider,
				err,
			)
			return
		}
		if metadata.empty() {
			log.Printf(
				"link preview metadata empty: message_id=%d preview_id=%d provider=%s",
				messageID,
				previewID,
				preview.Provider,
			)
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

		if metadata.ThumbnailURL == nil {
			return
		}
		store, err := storage.Default()
		if err != nil {
			log.Printf(
				"link preview thumbnail storage unavailable: message_id=%d preview_id=%d error=%v",
				messageID,
				previewID,
				err,
			)
			return
		}

		imageCtx, imageCancel := context.WithTimeout(context.Background(), 8*time.Second)
		key, err := cacheLinkPreviewImage(
			imageCtx,
			store,
			messageID,
			previewID,
			*metadata.ThumbnailURL,
		)
		imageCancel()
		if err != nil {
			log.Printf(
				"link preview thumbnail cache failed: message_id=%d preview_id=%d error=%v",
				messageID,
				previewID,
				err,
			)
			return
		}
		if err := db.Model(&models.MessageLinkPreview{}).
			Where("id = ? AND message_id = ?", previewID, messageID).
			Update("thumbnail_url", key).Error; err != nil {
			return
		}
		PublishMessageUpdate(context.Background(), messageID)
	}()
}

func cacheLinkPreviewImage(
	ctx context.Context,
	store storage.Storage,
	messageID uint,
	previewID uint,
	rawURL string,
) (string, error) {
	body, contentType, extension, err := linkPreviewImageFetcher(ctx, rawURL)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("link-preview-thumbnails/%d/%d%s", messageID, previewID, extension)
	if err := store.Upload(ctx, key, bytes.NewReader(body), contentType); err != nil {
		return "", err
	}
	return key, nil
}

func fetchLinkPreviewImage(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	if sanitizePreviewThumbnailURL(rawURL) == nil {
		return nil, "", "", ErrUnsafeVideoLink
	}

	client := &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
				host, port, err := net.SplitHostPort(address)
				if err != nil {
					return nil, err
				}
				addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
				if err != nil {
					return nil, err
				}
				if len(addresses) == 0 {
					return nil, errors.New("thumbnail host did not resolve")
				}
				for _, address := range addresses {
					if isUnsafeIP(address.IP) {
						return nil, ErrUnsafeVideoLink
					}
				}
				var dialErr error
				dialer := &net.Dialer{}
				for _, resolved := range addresses {
					conn, err := dialer.DialContext(
						ctx,
						network,
						net.JoinHostPort(resolved.IP.String(), port),
					)
					if err == nil {
						return conn, nil
					}
					dialErr = err
				}
				return nil, dialErr
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 || sanitizePreviewThumbnailURL(req.URL.String()) == nil {
				return ErrUnsafeVideoLink
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif")
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, "", "", fmt.Errorf("thumbnail download failed with status %d", resp.StatusCode)
	}
	if resp.ContentLength > linkPreviewImageMaxSize {
		return nil, "", "", errors.New("thumbnail is too large")
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, linkPreviewImageMaxSize+1))
	if err != nil {
		return nil, "", "", err
	}
	if len(body) == 0 || len(body) > linkPreviewImageMaxSize {
		return nil, "", "", errors.New("thumbnail is empty or too large")
	}

	contentType := http.DetectContentType(body)
	extensions := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/webp": ".webp",
		"image/gif":  ".gif",
	}
	extension, ok := extensions[contentType]
	if !ok {
		return nil, "", "", errors.New("unsupported thumbnail content type")
	}
	return body, contentType, extension, nil
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
	cmd := exec.CommandContext(ctx, "yt-dlp", buildYTDLPMetadataArgs(raw)...)
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

func buildYTDLPMetadataArgs(raw string) []string {
	args := []string{
		"--dump-single-json",
		"--skip-download",
		"--no-playlist",
		"--socket-timeout", "20",
		"--retries", "2",
	}
	args = appendYTDLPNetworkArgs(args)
	return append(args, raw)
}

func appendYTDLPNetworkArgs(args []string) []string {
	if proxy := strings.TrimSpace(os.Getenv("YTDLP_PROXY")); proxy != "" {
		args = append(args, "--proxy", proxy)
	}

	impersonate := strings.TrimSpace(os.Getenv("YTDLP_IMPERSONATE"))
	if impersonate == "" {
		impersonate = "chrome"
	}
	if impersonate != "-" && impersonate != "off" && impersonate != "false" {
		args = append(args, "--impersonate", impersonate)
	}

	if cookiesFile := strings.TrimSpace(os.Getenv("YTDLP_COOKIES_FILE")); cookiesFile != "" {
		args = append(args, "--cookies", cookiesFile)
	}
	return args
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
	if parsed.User != nil {
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
