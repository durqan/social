package push

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
	"net/url"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"golang.org/x/oauth2/google"

	"notifications/models"
)

var ErrSubscriptionInvalid = errors.New("push subscription invalid")
var ErrMobileTokenInvalid = errors.New("mobile push token invalid")

const firebaseMessagingScope = "https://www.googleapis.com/auth/firebase.messaging"

const (
	MobileChannelGeneral       = "general"
	MobileChannelMessages      = "messages"
	MobileChannelIncomingCalls = "incoming_calls"
)

type Payload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	URL            string `json:"url"`
	Tag            string `json:"tag"`
	NotificationID uint   `json:"notification_id"`
	Type           string `json:"type"`
	EntityID       uint   `json:"entity_id"`
	ActorID        uint   `json:"actor_id"`
	ConversationID uint   `json:"conversation_id"`
	SyncAction     string `json:"sync_action,omitempty"`
	Silent         bool   `json:"silent,omitempty"`
	// CallID is the ephemeral call identifier from the offer. Clients use it for
	// matching against active call state and for stale call detection.
	CallID string `json:"call_id,omitempty"`
}

type Service struct {
	publicKey     string
	privateKey    string
	subject       string
	httpClient    *http.Client
	webEnabled    bool
	fcmProjectID  string
	fcmHTTPClient *http.Client
	fcmEnabled    bool
}

func NewServiceFromEnv() *Service {
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	subject := os.Getenv("VAPID_SUBJECT")
	if subject == "" {
		subject = "example@example.com"
	}
	subject = normalizeVAPIDSubject(subject)

	webEnabled := publicKey != "" && privateKey != ""
	if !webEnabled {
		log.Println("web push disabled: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required")
	}

	fcmProjectID, fcmHTTPClient := newFCMClientFromEnv()
	fcmEnabled := fcmProjectID != "" && fcmHTTPClient != nil
	if !fcmEnabled {
		log.Println("FCM push disabled: set FCM_PROJECT_ID and Firebase service account credentials")
	}

	return &Service{
		publicKey:     publicKey,
		privateKey:    privateKey,
		subject:       subject,
		httpClient:    &http.Client{Timeout: 10 * time.Second},
		webEnabled:    webEnabled,
		fcmProjectID:  fcmProjectID,
		fcmHTTPClient: fcmHTTPClient,
		fcmEnabled:    fcmEnabled,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && (s.webEnabled || s.fcmEnabled)
}

func (s *Service) WebPushEnabled() bool {
	return s != nil && s.webEnabled
}

func (s *Service) FCMEnabled() bool {
	return s != nil && s.fcmEnabled
}

func (s *Service) Send(subscription models.PushSubscription, payload Payload) error {
	if !s.WebPushEnabled() {
		return nil
	}
	if payload.Silent {
		return nil
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	resp, err := webpush.SendNotification(body, &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			P256dh: subscription.P256DH,
			Auth:   subscription.Auth,
		},
	}, &webpush.Options{
		HTTPClient:      s.httpClient,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             86400,
		Urgency:         webpush.UrgencyNormal,
	})
	if resp != nil {
		defer resp.Body.Close()
	}

	if err != nil {
		return fmt.Errorf("web push request failed for %s: %w", endpointHost(subscription.Endpoint), err)
	}
	if resp != nil && isInvalidStatus(resp.StatusCode) {
		return fmt.Errorf(
			"%w: endpoint=%s status=%d body=%s",
			ErrSubscriptionInvalid,
			endpointHost(subscription.Endpoint),
			resp.StatusCode,
			responseBodySnippet(resp),
		)
	}
	if resp != nil && resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf(
			"web push failed: endpoint=%s status=%d body=%s",
			endpointHost(subscription.Endpoint),
			resp.StatusCode,
			responseBodySnippet(resp),
		)
	}

	return nil
}

func (s *Service) SendMobile(token models.MobilePushToken, payload Payload) error {
	if !s.FCMEnabled() {
		return nil
	}

	message := fcmMessage{
		Token: token.Token,
		Data: map[string]string{
			"type":            payload.Type,
			"url":             payload.URL,
			"tag":             payload.Tag,
			"notification_id": fmt.Sprintf("%d", payload.NotificationID),
			"entity_id":       fmt.Sprintf("%d", payload.EntityID),
			"message_id":      messageIDDataValue(payload),
			"actor_id":        fmt.Sprintf("%d", payload.ActorID),
			"sender_id":       fmt.Sprintf("%d", payload.ActorID),
			"caller_id":       fmt.Sprintf("%d", payload.ActorID), // explicit alias for call flows
			"conversation_id": fmt.Sprintf("%d", payload.ConversationID),
			"sync_action":     payload.SyncAction,
			"call_id":         payload.CallID,
			"ts":              "", // best effort; web deep link carries authoritative ts in the URL query
		},
		Android: fcmAndroidConfig{
			Priority: "HIGH",
		},
	}
	if !payload.Silent {
		message.Notification = &fcmNotification{
			Title: payload.Title,
			Body:  payload.Body,
		}
		message.Android.Notification = &fcmAndroidNotification{
			ChannelID: mobileChannelID(payload),
			Tag:       payload.Tag,
		}
	}

	body, err := json.Marshal(fcmSendRequest{
		Message: message,
	})
	if err != nil {
		return err
	}

	url := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", s.fcmProjectID)
	resp, err := s.fcmHTTPClient.Post(url, "application/json", bytes.NewReader(body))
	if resp != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		return err
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= http.StatusBadRequest {
		if isInvalidFCMResponse(resp.StatusCode, string(respBody)) {
			return fmt.Errorf("%w: status %d", ErrMobileTokenInvalid, resp.StatusCode)
		}
		return fmt.Errorf("FCM push failed with status %d", resp.StatusCode)
	}

	return nil
}

func mobileChannelID(payload Payload) string {
	switch payload.Type {
	case "message_received":
		return MobileChannelMessages
	case "incoming_call":
		return MobileChannelIncomingCalls
	default:
		return MobileChannelGeneral
	}
}

func messageIDDataValue(payload Payload) string {
	if payload.Type != "message_received" {
		return ""
	}
	return fmt.Sprintf("%d", payload.EntityID)
}

func isInvalidStatus(status int) bool {
	return status == http.StatusGone || status == http.StatusNotFound
}

func normalizeVAPIDSubject(subject string) string {
	subject = strings.TrimSpace(subject)
	lowerSubject := strings.ToLower(subject)

	if strings.HasPrefix(lowerSubject, "mailto:") {
		subject = strings.TrimSpace(subject[len("mailto:"):])
	}

	if strings.HasPrefix(strings.ToLower(subject), "https:") {
		return "https:" + subject[len("https:"):]
	}

	if len(subject) >= 2 && subject[0] == '<' && subject[len(subject)-1] == '>' {
		return strings.TrimSpace(subject[1 : len(subject)-1])
	}

	return subject
}

func endpointHost(endpoint string) string {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		return "unknown"
	}
	return parsed.Host
}

func responseBodySnippet(resp *http.Response) string {
	if resp == nil || resp.Body == nil {
		return ""
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if err != nil {
		return fmt.Sprintf("read_error:%v", err)
	}

	return strings.TrimSpace(string(body))
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

func newFCMClientFromEnv() (string, *http.Client) {
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
		return "", nil
	}

	cfg, err := google.JWTConfigFromJSON(credentials, firebaseMessagingScope)
	if err != nil {
		log.Printf("FCM credentials invalid: %v", err)
		return "", nil
	}

	return projectID, cfg.Client(context.Background())
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

func isInvalidFCMResponse(status int, body string) bool {
	if status == http.StatusNotFound {
		return true
	}

	body = strings.ToUpper(body)
	return strings.Contains(body, "UNREGISTERED") ||
		strings.Contains(body, "REGISTRATION_TOKEN_NOT_REGISTERED") ||
		strings.Contains(body, "NOT A VALID FCM REGISTRATION TOKEN")
}
