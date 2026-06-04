package dto

import (
	"strings"
	"testing"

	"tester/internal/models"
)

func TestToUserResponseAvatarUsesBackendEndpoint(t *testing.T) {
	user := models.User{
		ID:     42,
		Name:   "Alice",
		Email:  "alice@example.com",
		Avatar: "https://storage.yandexcloud.net/private-bucket/avatars/user_42/avatar.png",
	}

	response := ToUserResponse(user)
	if response.Avatar != "/api/avatars/users/42" {
		t.Fatalf("unexpected avatar response %q", response.Avatar)
	}
	if strings.Contains(response.Avatar, "storage.yandexcloud.net") {
		t.Fatalf("avatar response must not contain direct S3 URL: %q", response.Avatar)
	}
}
