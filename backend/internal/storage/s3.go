package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	awsAlgorithm     = "AWS4-HMAC-SHA256"
	awsService       = "s3"
	unsignedPayload  = "UNSIGNED-PAYLOAD"
	emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

type S3Storage struct {
	endpoint        string
	region          string
	bucket          string
	accessKeyID     string
	secretAccessKey string
	sessionToken    string
	publicBase      string
	pathStyle       bool
	client          *http.Client
}

func NewS3StorageFromEnv() (*S3Storage, error) {
	store := &S3Storage{
		endpoint:        strings.TrimRight(strings.TrimSpace(os.Getenv("S3_ENDPOINT")), "/"),
		region:          getEnv("S3_REGION", "auto"),
		bucket:          strings.TrimSpace(os.Getenv("S3_BUCKET")),
		accessKeyID:     strings.TrimSpace(os.Getenv("S3_ACCESS_KEY_ID")),
		secretAccessKey: strings.TrimSpace(os.Getenv("S3_SECRET_ACCESS_KEY")),
		sessionToken:    strings.TrimSpace(os.Getenv("S3_SESSION_TOKEN")),
		publicBase:      strings.TrimRight(strings.TrimSpace(os.Getenv("S3_PUBLIC_BASE_URL")), "/"),
		pathStyle:       strings.ToLower(strings.TrimSpace(os.Getenv("S3_FORCE_PATH_STYLE"))) != "false",
		client:          &http.Client{Timeout: 30 * time.Second},
	}

	if store.endpoint == "" || store.bucket == "" || store.accessKeyID == "" || store.secretAccessKey == "" {
		return nil, fmt.Errorf("S3 storage requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")
	}

	return store, nil
}

func (s *S3Storage) Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) (Object, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return Object{}, err
	}

	body, err := io.ReadAll(reader)
	if err != nil {
		return Object{}, err
	}
	if size <= 0 {
		size = int64(len(body))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectEndpoint(cleanedKey), bytes.NewReader(body))
	if err != nil {
		return Object{}, err
	}
	req.Header.Set("Content-Type", contentType)
	payloadHash := sha256Hex(body)
	s.signHeaderRequest(req, payloadHash, time.Now().UTC())

	resp, err := s.client.Do(req)
	if resp != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		return Object{}, err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return Object{}, fmt.Errorf("S3 upload failed with status %d", resp.StatusCode)
	}

	objectURL, err := s.GetURL(ctx, cleanedKey)
	if err != nil {
		return Object{}, err
	}

	return Object{
		Key:         cleanedKey,
		URL:         objectURL,
		ContentType: contentType,
		Size:        size,
	}, nil
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectEndpoint(cleanedKey), nil)
	if err != nil {
		return err
	}
	s.signHeaderRequest(req, emptyPayloadHash, time.Now().UTC())

	resp, err := s.client.Do(req)
	if resp != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		return err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("S3 delete failed with status %d", resp.StatusCode)
	}
	return nil
}

func (s *S3Storage) GetURL(_ context.Context, key string) (string, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", err
	}

	if s.publicBase != "" {
		return s.publicBase + "/" + escapeKey(cleanedKey), nil
	}
	return s.objectEndpoint(cleanedKey), nil
}

func (s *S3Storage) SignedURL(_ context.Context, key string, ttl time.Duration) (string, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", err
	}
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	if ttl > 7*24*time.Hour {
		ttl = 7 * 24 * time.Hour
	}

	now := time.Now().UTC()
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	credentialScope := fmt.Sprintf("%s/%s/aws4_request", date, s.region)
	rawURL := s.objectEndpoint(cleanedKey)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}

	query := parsed.Query()
	query.Set("X-Amz-Algorithm", awsAlgorithm)
	query.Set("X-Amz-Credential", fmt.Sprintf("%s/%s", s.accessKeyID, credentialScope))
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", fmt.Sprintf("%d", int(ttl.Seconds())))
	query.Set("X-Amz-SignedHeaders", "host")
	if s.sessionToken != "" {
		query.Set("X-Amz-Security-Token", s.sessionToken)
	}
	parsed.RawQuery = canonicalQuery(query)

	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		parsed.EscapedPath(),
		parsed.RawQuery,
		"host:" + parsed.Host + "\n",
		"host",
		unsignedPayload,
	}, "\n")
	stringToSign := strings.Join([]string{
		awsAlgorithm,
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signature := hex.EncodeToString(hmacSHA256(s.signingKey(date), stringToSign))
	query.Set("X-Amz-Signature", signature)
	parsed.RawQuery = canonicalQuery(query)
	return parsed.String(), nil
}

func (s *S3Storage) objectEndpoint(key string) string {
	escapedKey := escapeKey(key)
	if s.pathStyle {
		return fmt.Sprintf("%s/%s/%s", s.endpoint, s.bucket, escapedKey)
	}

	parsed, err := url.Parse(s.endpoint)
	if err != nil {
		return fmt.Sprintf("%s/%s/%s", s.endpoint, s.bucket, escapedKey)
	}
	parsed.Host = s.bucket + "." + parsed.Host
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + escapedKey
	return parsed.String()
}

func (s *S3Storage) signHeaderRequest(req *http.Request, payloadHash string, now time.Time) {
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	credentialScope := fmt.Sprintf("%s/%s/aws4_request", date, s.region)

	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if s.sessionToken != "" {
		req.Header.Set("X-Amz-Security-Token", s.sessionToken)
	}

	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := strings.Join([]string{
		"host:" + req.URL.Host,
		"x-amz-content-sha256:" + payloadHash,
		"x-amz-date:" + amzDate,
		"",
	}, "\n")

	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		canonicalQuery(req.URL.Query()),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	stringToSign := strings.Join([]string{
		awsAlgorithm,
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signature := hex.EncodeToString(hmacSHA256(s.signingKey(date), stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf(
		"%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		awsAlgorithm,
		s.accessKeyID,
		credentialScope,
		signedHeaders,
		signature,
	))
}

func (s *S3Storage) signingKey(date string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+s.secretAccessKey), date)
	regionKey := hmacSHA256(dateKey, s.region)
	serviceKey := hmacSHA256(regionKey, awsService)
	return hmacSHA256(serviceKey, "aws4_request")
}

func hmacSHA256(key []byte, value string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(value))
	return h.Sum(nil)
}

func sha256Hex(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.Join(parts, "/")
}

func canonicalQuery(values url.Values) string {
	if len(values) == 0 {
		return ""
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0)
	for _, key := range keys {
		valueParts := append([]string(nil), values[key]...)
		sort.Strings(valueParts)
		for _, value := range valueParts {
			parts = append(parts, url.QueryEscape(key)+"="+url.QueryEscape(value))
		}
	}
	return strings.Join(parts, "&")
}
