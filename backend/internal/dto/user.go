package dto

import (
	"fmt"
	"strings"
	"time"

	"tester/internal/models"
)

type PublicUserResponse struct {
	ID              uint       `json:"id"`
	Name            string     `json:"name"`
	Age             int        `json:"age"`
	Bio             string     `json:"bio"`
	Avatar          string     `json:"avatar"`
	AvatarPositionX float64    `json:"avatar_position_x"`
	AvatarPositionY float64    `json:"avatar_position_y"`
	AvatarScale     float64    `json:"avatar_scale"`
	IsEmailVerified bool       `json:"is_email_verified"`
	CreatedAt       time.Time  `json:"created_at"`
	LastSeenAt      *time.Time `json:"last_seen_at"`
}

type PrivateUserResponse struct {
	PublicUserResponse
	Email string `json:"email"`
}

type UpdateUserRequest struct {
	Name            *string  `json:"name"`
	Email           *string  `json:"email" binding:"omitempty,email"`
	Age             *int     `json:"age"`
	Bio             *string  `json:"bio"`
	AvatarPositionX *float64 `json:"avatar_position_x"`
	AvatarPositionY *float64 `json:"avatar_position_y"`
	AvatarScale     *float64 `json:"avatar_scale"`
}

type ChangePasswordRequest struct {
	CurrentPassword    string  `json:"current_password" binding:"required"`
	NewPassword        string  `json:"new_password" binding:"required,min=6"`
	EncryptedMasterKey *string `json:"encrypted_master_key"`
}

func ToPublicUserResponse(user models.User) PublicUserResponse {
	user = WithResolvedAvatar(user)
	return PublicUserResponse{
		ID:              user.ID,
		Name:            user.Name,
		Age:             user.Age,
		Bio:             user.Bio,
		Avatar:          user.Avatar,
		AvatarPositionX: user.AvatarPositionX,
		AvatarPositionY: user.AvatarPositionY,
		AvatarScale:     user.AvatarScale,
		IsEmailVerified: user.IsEmailVerified,
		CreatedAt:       user.CreatedAt,
		LastSeenAt:      user.LastSeenAt,
	}
}

func ToPublicUserResponses(users []models.User) []PublicUserResponse {
	responses := make([]PublicUserResponse, 0, len(users))
	for _, user := range users {
		responses = append(responses, ToPublicUserResponse(user))
	}
	return responses
}

func ToPrivateUserResponse(user models.User) PrivateUserResponse {
	return PrivateUserResponse{
		PublicUserResponse: ToPublicUserResponse(user),
		Email:              user.Email,
	}
}

func WithResolvedAvatar(user models.User) models.User {
	user.Avatar = AvatarEndpoint(user.ID, user.Avatar)
	return user
}

func ToPublicUser(user models.User) models.User {
	user = WithResolvedAvatar(user)
	user.Email = ""
	return user
}

func WithResolvedAvatars(users []models.User) []models.User {
	for i := range users {
		users[i] = WithResolvedAvatar(users[i])
	}
	return users
}

func AvatarEndpoint(userID uint, storedAvatar string) string {
	if userID == 0 || strings.TrimSpace(storedAvatar) == "" {
		return ""
	}
	return fmt.Sprintf("/api/avatars/users/%d", userID)
}
