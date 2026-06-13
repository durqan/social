package push

import (
	"encoding/json"
	"testing"
)

func TestFCMMessageOmitsNotificationForSilentPayload(t *testing.T) {
	message := fcmMessage{
		Token: "token",
		Data: map[string]string{
			"type": "notification_sync",
		},
		Android: fcmAndroidConfig{
			Priority: "HIGH",
		},
	}

	body, err := json.Marshal(fcmSendRequest{Message: message})
	if err != nil {
		t.Fatalf("marshal FCM request: %v", err)
	}

	var decoded map[string]map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal FCM request: %v", err)
	}

	if _, ok := decoded["message"]["notification"]; ok {
		t.Fatalf("silent FCM message must not include notification: %s", body)
	}
}

func TestFCMMessageIncludesNotificationForVisiblePayload(t *testing.T) {
	message := fcmMessage{
		Token: "token",
		Notification: &fcmNotification{
			Title: "Новое сообщение",
			Body:  "Привет",
		},
		Data: map[string]string{
			"type": "message_received",
		},
		Android: fcmAndroidConfig{
			Priority: "HIGH",
			Notification: &fcmAndroidNotification{
				ChannelID: "social_notifications",
				Tag:       "message:1",
			},
		},
	}

	body, err := json.Marshal(fcmSendRequest{Message: message})
	if err != nil {
		t.Fatalf("marshal FCM request: %v", err)
	}

	var decoded map[string]map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal FCM request: %v", err)
	}

	notification, ok := decoded["message"]["notification"].(map[string]any)
	if !ok {
		t.Fatalf("visible FCM message must include notification: %s", body)
	}
	if notification["title"] != "Новое сообщение" || notification["body"] != "Привет" {
		t.Fatalf("unexpected notification payload: %#v", notification)
	}
}
