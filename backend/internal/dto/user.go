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
	IsEmailVerified bool      `json:"is_email_verified"`
	CreatedAt       time.Time `json:"created_at"`
}

type CreateUserRequest struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Age      int    `json:"age"`
	Bio      string `json:"bio"`
	Avatar   string `json:"avatar"`
}

type UpdateUserRequest struct {
	Name   *string `json:"name"`
	Email  *string `json:"email" binding:"omitempty,email"`
	Age    *int    `json:"age"`
	Bio    *string `json:"bio"`
	Avatar *string `json:"avatar"`
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
