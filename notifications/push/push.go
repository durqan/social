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
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2/google"

	"notifications/models"
)

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
	// CallType is "audio" or "video" for incoming_call notifications.
	CallType string `json:"call_type,omitempty"`
}

type Service struct {
	fcmProjectID  string
	fcmHTTPClient *http.Client
	fcmEnabled    bool
}

func NewServiceFromEnv() *Service {
	fcmProjectID, fcmHTTPClient := newFCMClientFromEnv()
	fcmEnabled := fcmProjectID != "" && fcmHTTPClient != nil
	if !fcmEnabled {
		log.Println("FCM push disabled: set FCM_PROJECT_ID and Firebase service account credentials")
	}

	return &Service{
		fcmProjectID:  fcmProjectID,
		fcmHTTPClient: fcmHTTPClient,
		fcmEnabled:    fcmEnabled,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.fcmEnabled
}

func (s *Service) FCMEnabled() bool {
	return s != nil && s.fcmEnabled
}

func (s *Service) SendMobile(token models.MobilePushToken, payload Payload) error {
	if !s.FCMEnabled() {
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
			"caller_id":       fmt.Sprintf("%d", payload.ActorID), // explicit alias for call flows
			"conversation_id": fmt.Sprintf("%d", payload.ConversationID),
			"sync_action":     payload.SyncAction,
			"call_id":         payload.CallID,
			"call_type":       payload.CallType,
			"title":           payload.Title,
			"body":            payload.Body,
			"ts":              fmt.Sprintf("%d", time.Now().UnixMilli()),
		},
		Android: fcmAndroidConfig{
			Priority: "HIGH",
		},
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
	case "incoming_call", "call_ended", "call_rejected", "call_missed":
		return MobileChannelIncomingCalls
	default:
		return MobileChannelGeneral
	}
}

func isCallControlPush(pushType string) bool {
	return pushType == "incoming_call" ||
		pushType == "call_ended" ||
		pushType == "call_rejected" ||
		pushType == "call_missed"
}

func messageIDDataValue(payload Payload) string {
	if payload.Type != "message_received" {
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

	client := cfg.Client(context.Background())
	client.Timeout = 10 * time.Second
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

func isInvalidFCMResponse(status int, body string) bool {
	if status == http.StatusNotFound {
		return true
	}

	body = strings.ToUpper(body)
	return strings.Contains(body, "UNREGISTERED") ||
		strings.Contains(body, "REGISTRATION_TOKEN_NOT_REGISTERED") ||
		strings.Contains(body, "NOT A VALID FCM REGISTRATION TOKEN")
}
