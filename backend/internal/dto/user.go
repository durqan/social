package dto

import (
	"tester/internal/models"
	"time"
)

type UserResponse struct {
	ID              uint      `json:"id"`
	Name            string    `json:"name"`
	Email           string    `json:"email"`
	Age             int       `json:"age"`
	Bio             string    `json:"bio"`
	Avatar          string    `json:"avatar"`
	AvatarPositionX float64   `json:"avatar_position_x"`
	AvatarPositionY float64   `json:"avatar_position_y"`
	AvatarScale     float64   `json:"avatar_scale"`
	IsEmailVerified bool      `json:"is_email_verified"`
	CreatedAt       time.Time `json:"created_at"`
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
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
}

func ToUserResponse(user models.User) UserResponse {
	return UserResponse{
		ID:              user.ID,
		Name:            user.Name,
		Email:           user.Email,
		Age:             user.Age,
		Bio:             user.Bio,
		Avatar:          user.Avatar,
		AvatarPositionX: user.AvatarPositionX,
		AvatarPositionY: user.AvatarPositionY,
		AvatarScale:     user.AvatarScale,
		IsEmailVerified: user.IsEmailVerified,
		CreatedAt:       user.CreatedAt,
	}
}

func ToUserResponses(users []models.User) []UserResponse {
	responses := make([]UserResponse, 0, len(users))
	for _, user := range users {
		responses = append(responses, ToUserResponse(user))
	}
	return responses
}
