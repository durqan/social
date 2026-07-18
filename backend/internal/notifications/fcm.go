package notifications

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"tester/internal/models"

	"golang.org/x/oauth2/google"
)

var ErrMobileTokenInvalid = errors.New("mobile push token invalid")

const (
	firebaseMessagingScope = "https://www.googleapis.com/auth/firebase.messaging"
	fcmRequestTimeout      = 10 * time.Second
	maxFCMRetryAfter       = 24 * time.Hour

	mobileChannelGeneral       = "general"
	mobileChannelMessages      = "messages"
	mobileChannelIncomingCalls = "incoming_calls"
)

type Payload struct {
	Title          string
	Body           string
	Tag            string
	NotificationID uint
	Type           string
	EntityID       uint
	ActorID        uint
	ConversationID uint
	SyncAction     string
	Silent         bool
	CallID         string
	CallType       string
}

type FCMClient struct {
	projectID  string
	httpClient *http.Client
	enabled    bool
}

type fcmResponseError struct {
	statusCode int
	retryable  bool
	retryAfter time.Duration
}

func (e *fcmResponseError) Error() string {
	return fmt.Sprintf("FCM push failed with status %d", e.statusCode)
}

func (e *fcmResponseError) RetryAfter() time.Duration {
	return e.retryAfter
}

type retryAfterProvider interface {
	RetryAfter() time.Duration
}

// RetryAfter returns a provider-requested minimum delay for a retry, if any.
func RetryAfter(err error) time.Duration {
	var provider retryAfterProvider
	if !errors.As(err, &provider) {
		return 0
	}
	delay := provider.RetryAfter()
	if delay < 0 {
		return 0
	}
	return delay
}

func newFCMClientFromEnv() *FCMClient {
	projectID, httpClient := configureFCMClient()
	enabled := projectID != "" && httpClient != nil
	if !enabled {
		log.Println("FCM push disabled: set FCM_PROJECT_ID and Firebase service account credentials")
	}

	return &FCMClient{
		projectID:  projectID,
		httpClient: httpClient,
		enabled:    enabled,
	}
}

func (c *FCMClient) Enabled() bool {
	return c != nil && c.enabled
}

func (c *FCMClient) SendMobile(ctx context.Context, token models.MobilePushToken, payload Payload) error {
	if !c.Enabled() {
		return nil
	}

	message := fcmMessage{
		Token: token.Token,
		Data: map[string]string{
			"type":            payload.Type,
			"tag":             payload.Tag,
			"notification_id": fmt.Sprintf("%d", payload.NotificationID),
			"entity_id":       fmt.Sprintf("%d", payload.EntityID),
			"message_id":      messageIDDataValue(payload),
			"actor_id":        fmt.Sprintf("%d", payload.ActorID),
			"sender_id":       fmt.Sprintf("%d", payload.ActorID),
			"caller_id":       fmt.Sprintf("%d", payload.ActorID),
			"conversation_id": fmt.Sprintf("%d", payload.ConversationID),
			"sync_action":     payload.SyncAction,
			"call_id":         payload.CallID,
			"call_type":       payload.CallType,
			"title":           payload.Title,
			"body":            payload.Body,
			"ts":              fmt.Sprintf("%d", time.Now().UnixMilli()),
		},
		Android: fcmAndroidConfig{Priority: "HIGH"},
	}
	if !payload.Silent && !isCallControlPush(payload.Type) {
		message.Notification = &fcmNotification{
			Title: payload.Title,
			Body:  payload.Body,
		}
		message.Android.Notification = &fcmAndroidNotification{
			ChannelID: mobileChannelID(payload),
			Tag:       payload.Tag,
		}
	}

	body, err := json.Marshal(fcmSendRequest{Message: message})
	if err != nil {
		return err
	}

	requestCtx, cancel := context.WithTimeout(ctx, fcmRequestTimeout)
	defer cancel()
	endpoint := fmt.Sprintf(
		"https://fcm.googleapis.com/v1/projects/%s/messages:send",
		c.projectID,
	)
	request, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(request)
	if response != nil {
		defer response.Body.Close()
	}
	if err != nil {
		return err
	}

	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	if response.StatusCode < http.StatusBadRequest {
		return nil
	}
	if isInvalidFCMResponse(string(responseBody)) {
		return fmt.Errorf("%w: status %d", ErrMobileTokenInvalid, response.StatusCode)
	}
	return &fcmResponseError{
		statusCode: response.StatusCode,
		retryable:  isRetryableFCMStatus(response.StatusCode),
		retryAfter: parseFCMRetryAfter(response.Header.Get("Retry-After"), time.Now()),
	}
}

func isPermanentFCMError(err error) bool {
	var responseError *fcmResponseError
	return errors.As(err, &responseError) && !responseError.retryable
}

func mobileChannelID(payload Payload) string {
	switch payload.Type {
	case TypeMessage:
		return mobileChannelMessages
	case TypeIncomingCall, TypeCallEnded, TypeCallRejected, TypeCallMissed:
		return mobileChannelIncomingCalls
	default:
		return mobileChannelGeneral
	}
}

func isCallControlPush(pushType string) bool {
	return pushType == TypeIncomingCall ||
		pushType == TypeCallEnded ||
		pushType == TypeCallRejected ||
		pushType == TypeCallMissed
}

func messageIDDataValue(payload Payload) string {
	if payload.Type != TypeMessage {
		return ""
	}
	return fmt.Sprintf("%d", payload.EntityID)
}

type fcmSendRequest struct {
	Message fcmMessage `json:"message"`
}

type fcmMessage struct {
	Token        string            `json:"token"`
	Notification *fcmNotification  `json:"notification,omitempty"`
	Data         map[string]string `json:"data"`
	Android      fcmAndroidConfig  `json:"android"`
}

type fcmNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

type fcmAndroidConfig struct {
	Priority     string                  `json:"priority"`
	Notification *fcmAndroidNotification `json:"notification,omitempty"`
}

type fcmAndroidNotification struct {
	ChannelID string `json:"channel_id"`
	Tag       string `json:"tag,omitempty"`
}

func configureFCMClient() (string, *http.Client) {
	credentials, err := firebaseCredentialsFromEnv()
	if err != nil {
		log.Printf("FCM credentials unavailable: %v", err)
		return "", nil
	}
	if len(credentials) == 0 {
		return "", nil
	}

	projectID := strings.TrimSpace(os.Getenv("FCM_PROJECT_ID"))
	if projectID == "" {
		projectID = projectIDFromCredentials(credentials)
	}
	if projectID == "" {
		log.Println("FCM credentials do not contain a project id")
		return "", nil
	}

	config, err := google.JWTConfigFromJSON(credentials, firebaseMessagingScope)
	if err != nil {
		log.Printf("FCM credentials invalid: %v", err)
		return "", nil
	}

	client := config.Client(context.Background())
	client.Timeout = fcmRequestTimeout
	return projectID, client
}

func firebaseCredentialsFromEnv() ([]byte, error) {
	if encoded := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON_BASE64")); encoded != "" {
		return base64.StdEncoding.DecodeString(encoded)
	}
	if raw := strings.TrimSpace(os.Getenv("FIREBASE_SERVICE_ACCOUNT_JSON")); raw != "" {
		return []byte(raw), nil
	}
	if path := strings.TrimSpace(os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")); path != "" {
		return os.ReadFile(path)
	}
	return nil, nil
}

func projectIDFromCredentials(credentials []byte) string {
	var payload struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(credentials, &payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.ProjectID)
}

func isInvalidFCMResponse(body string) bool {
	body = strings.ToUpper(body)
	return strings.Contains(body, "UNREGISTERED") ||
		strings.Contains(body, "REGISTRATION_TOKEN_NOT_REGISTERED") ||
		strings.Contains(body, "NOT A VALID FCM REGISTRATION TOKEN")
}

func isRetryableFCMStatus(status int) bool {
	return status == http.StatusRequestTimeout ||
		status == http.StatusTooManyRequests ||
		status >= http.StatusInternalServerError
}

func parseFCMRetryAfter(raw string, now time.Time) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if seconds <= 0 {
			return 0
		}
		return min(time.Duration(seconds)*time.Second, maxFCMRetryAfter)
	}
	retryAt, err := http.ParseTime(raw)
	if err != nil || !retryAt.After(now) {
		return 0
	}
	return min(retryAt.Sub(now), maxFCMRetryAfter)
}
