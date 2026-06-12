package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
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
	endpoint     string
	region       string
	bucket       string
	accessKey    string
	secretKey    string
	sessionToken string
	publicBase   string
	pathStyle    bool
	client       *http.Client
	uploadSlots  chan struct{}
}

func NewS3StorageFromEnv() (*S3Storage, error) {
	store := &S3Storage{
		endpoint:     strings.TrimRight(strings.TrimSpace(os.Getenv("S3_ENDPOINT")), "/"),
		region:       getEnv("S3_REGION", "auto"),
		bucket:       strings.TrimSpace(os.Getenv("S3_BUCKET")),
		accessKey:    firstEnv("S3_ACCESS_KEY", "S3_ACCESS_KEY_ID"),
		secretKey:    firstEnv("S3_SECRET_KEY", "S3_SECRET_ACCESS_KEY"),
		sessionToken: strings.TrimSpace(os.Getenv("S3_SESSION_TOKEN")),
		publicBase:   strings.TrimRight(strings.TrimSpace(os.Getenv("S3_PUBLIC_BASE_URL")), "/"),
		pathStyle:    strings.ToLower(strings.TrimSpace(os.Getenv("S3_FORCE_PATH_STYLE"))) != "false",
		client:       &http.Client{Timeout: 30 * time.Second},
		uploadSlots:  make(chan struct{}, uploadConcurrencyFromEnv()),
	}

	if store.endpoint == "" || store.bucket == "" || store.accessKey == "" || store.secretKey == "" {
		return nil, fmt.Errorf("S3 storage requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY")
	}

	return store, nil
}

func (s *S3Storage) Upload(ctx context.Context, key string, reader io.Reader, contentType string) error {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return err
	}

	if strings.TrimSpace(contentType) == "" {
		contentType = "application/octet-stream"
	}

	if err := s.acquireUploadSlot(ctx); err != nil {
		return err
	}
	defer s.releaseUploadSlot()

	contentLength := contentLengthFromReader(reader)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectEndpoint(cleanedKey), reader)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	if contentLength >= 0 {
		req.ContentLength = contentLength
	}
	s.signHeaderRequest(req, unsignedPayload, time.Now().UTC())

	resp, err := s.client.Do(req)
	if resp != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		return err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("S3 upload failed with status %d", resp.StatusCode)
	}

	return nil
}

func (s *S3Storage) acquireUploadSlot(ctx context.Context) error {
	select {
	case s.uploadSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *S3Storage) releaseUploadSlot() {
	<-s.uploadSlots
}

func contentLengthFromReader(reader io.Reader) int64 {
	seeker, ok := reader.(io.Seeker)
	if !ok {
		return -1
	}

	current, err := seeker.Seek(0, io.SeekCurrent)
	if err != nil {
		return -1
	}
	end, err := seeker.Seek(0, io.SeekEnd)
	if err != nil {
		_, _ = seeker.Seek(current, io.SeekStart)
		return -1
	}
	if _, err := seeker.Seek(current, io.SeekStart); err != nil {
		return -1
	}
	if end < current {
		return -1
	}
	return end - current
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
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("S3 delete failed with status %d", resp.StatusCode)
	}
	return nil
}

func (s *S3Storage) URL(_ context.Context, key string) (string, error) {
	cleanedKey, err := cleanKey(key)
	if err != nil {
		return "", err
	}

	if s.publicBase != "" {
		return s.publicBase + "/" + escapeKey(cleanedKey), nil
	}
	return s.objectEndpoint(cleanedKey), nil
}

func (s *S3Storage) ListPrefix(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	cleanPrefix, err := cleanKey(prefix)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(strings.TrimSpace(prefix), "/") {
		cleanPrefix += "/"
	}

	var objects []ObjectInfo
	continuationToken := ""
	for {
		endpoint, err := url.Parse(s.bucketEndpoint())
		if err != nil {
			return nil, err
		}
		query := endpoint.Query()
		query.Set("list-type", "2")
		query.Set("prefix", cleanPrefix)
		if continuationToken != "" {
			query.Set("continuation-token", continuationToken)
		}
		endpoint.RawQuery = query.Encode()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
		if err != nil {
			return nil, err
		}
		s.signHeaderRequest(req, emptyPayloadHash, time.Now().UTC())

		resp, err := s.client.Do(req)
		if err != nil {
			return nil, err
		}
		if resp == nil {
			return nil, fmt.Errorf("S3 list failed without response")
		}
		if resp.StatusCode >= http.StatusBadRequest {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("S3 list failed with status %d", resp.StatusCode)
		}

		var result listBucketResult
		err = xml.NewDecoder(resp.Body).Decode(&result)
		_ = resp.Body.Close()
		if err != nil {
			return nil, err
		}
		for _, item := range result.Contents {
			objects = append(objects, ObjectInfo{
				Key:          item.Key,
				LastModified: item.LastModified,
				Size:         item.Size,
			})
		}
		if !result.IsTruncated || result.NextContinuationToken == "" {
			break
		}
		continuationToken = result.NextContinuationToken
	}

	return objects, nil
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
	credentialScope := fmt.Sprintf("%s/%s/%s/aws4_request", date, s.region, awsService)
	rawURL := s.objectEndpoint(cleanedKey)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}

	query := parsed.Query()
	query.Set("X-Amz-Algorithm", awsAlgorithm)
	query.Set("X-Amz-Credential", fmt.Sprintf("%s/%s", s.accessKey, credentialScope))
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

func (s *S3Storage) bucketEndpoint() string {
	if s.pathStyle {
		return fmt.Sprintf("%s/%s", s.endpoint, s.bucket)
	}

	parsed, err := url.Parse(s.endpoint)
	if err != nil {
		return fmt.Sprintf("%s/%s", s.endpoint, s.bucket)
	}
	parsed.Host = s.bucket + "." + parsed.Host
	return parsed.String()
}

type listBucketResult struct {
	XMLName               xml.Name       `xml:"ListBucketResult"`
	IsTruncated           bool           `xml:"IsTruncated"`
	NextContinuationToken string         `xml:"NextContinuationToken"`
	Contents              []s3ObjectInfo `xml:"Contents"`
}

type s3ObjectInfo struct {
	Key          string    `xml:"Key"`
	LastModified time.Time `xml:"LastModified"`
	Size         int64     `xml:"Size"`
}

func (s *S3Storage) signHeaderRequest(req *http.Request, payloadHash string, now time.Time) {
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	credentialScope := fmt.Sprintf("%s/%s/%s/aws4_request", date, s.region, awsService)

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
		s.accessKey,
		credentialScope,
		signedHeaders,
		signature,
	))
}

func (s *S3Storage) signingKey(date string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+s.secretKey), date)
	regionKey := hmacSHA256(dateKey, s.region)
	serviceKey := hmacSHA256(regionKey, awsService)
	return hmacSHA256(serviceKey, "aws4_request")
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func uploadConcurrencyFromEnv() int {
	raw := firstEnv("S3_UPLOAD_CONCURRENCY", "STORAGE_UPLOAD_CONCURRENCY")
	if raw == "" {
		return 4
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return 4
	}
	if value > 32 {
		return 32
	}
	return value
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
