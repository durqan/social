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
				ChannelID: MobileChannelMessages,
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

func TestMobileChannelIDMatchesNotificationType(t *testing.T) {
	tests := []struct {
		name    string
		payload Payload
		want    string
	}{
		{
			name:    "message",
			payload: Payload{Type: "message_received"},
			want:    MobileChannelMessages,
		},
		{
			name:    "incoming call",
			payload: Payload{Type: "incoming_call"},
			want:    MobileChannelIncomingCalls,
		},
		{
			name:    "fallback",
			payload: Payload{Type: "friend_request"},
			want:    MobileChannelGeneral,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := mobileChannelID(tt.payload); got != tt.want {
				t.Fatalf("mobileChannelID() = %q, want %q", got, tt.want)
			}
		})
	}
}
