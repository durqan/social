package dto

import (
	"encoding/json"
	"testing"

	"tester/internal/models"
)

func TestPublicUserResponseOmitsEmail(t *testing.T) {
	response := ToPublicUserResponse(models.User{
		ID:    1,
		Name:  "Public User",
		Email: "public@example.com",
	})

	body, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["email"]; exists {
		t.Fatalf("public user response leaked email field: %s", body)
	}
}

func TestPrivateUserResponseIncludesEmail(t *testing.T) {
	response := ToPrivateUserResponse(models.User{
		ID:    1,
		Name:  "Private User",
		Email: "private@example.com",
	})

	body, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["email"] != "private@example.com" {
		t.Fatalf("private user response did not include email: %s", body)
	}
}
