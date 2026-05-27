package push

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"notifications/models"
)

var ErrSubscriptionInvalid = errors.New("push subscription invalid")

type Payload struct {
	Title          string `json:"title"`
	Body           string `json:"body"`
	URL            string `json:"url"`
	Tag            string `json:"tag"`
	NotificationID uint   `json:"notification_id"`
	Type           string `json:"type"`
	EntityID       uint   `json:"entity_id"`
	ActorID        uint   `json:"actor_id"`
}

type Service struct {
	publicKey  string
	privateKey string
	subject    string
	httpClient *http.Client
	enabled    bool
}

func NewServiceFromEnv() *Service {
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	subject := os.Getenv("VAPID_SUBJECT")
	if subject == "" {
		subject = "mailto:example@example.com"
	}

	enabled := publicKey != "" && privateKey != ""
	if !enabled {
		log.Println("web push disabled: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required")
	}

	return &Service{
		publicKey:  publicKey,
		privateKey: privateKey,
		subject:    subject,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		enabled:    enabled,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.enabled
}

func (s *Service) Send(subscription models.PushSubscription, payload Payload) error {
	if !s.Enabled() {
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

	if resp != nil && isInvalidStatus(resp.StatusCode) {
		return fmt.Errorf("%w: status %d", ErrSubscriptionInvalid, resp.StatusCode)
	}
	if err != nil {
		return err
	}
	if resp != nil && resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("web push failed with status %d", resp.StatusCode)
	}

	return nil
}

func isInvalidStatus(status int) bool {
	return status == http.StatusGone || status == http.StatusNotFound
}
