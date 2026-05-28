package services

import (
	"errors"
	"strings"

	"tester/internal/models"
	"tester/internal/repository"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrRegistrationRejected = errors.New("registration rejected")
	ErrEmailAlreadyExists   = errors.New("email already exists")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrCurrentPassword      = errors.New("current password is incorrect")
)

type RegisterUserInput struct {
	Name     string
	Email    string
	Password string
	Website  string
}

func RegisterUser(db *gorm.DB, input RegisterUserInput) (models.User, error) {
	if strings.TrimSpace(input.Website) != "" {
		return models.User{}, ErrRegistrationRejected
	}

	_, err := repository.GetUserByEmail(db, input.Email)
	if err == nil {
		return models.User{}, ErrEmailAlreadyExists
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return models.User{}, err
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return models.User{}, err
	}

	user := models.User{
		Name:     input.Name,
		Email:    input.Email,
		Password: string(hashedPassword),
	}

	if err := repository.CreateUser(db, &user); err != nil {
		return models.User{}, err
	}

	return user, nil
}

func AuthenticateUser(db *gorm.DB, email, password string) (models.User, error) {
	user, err := repository.GetUserByEmail(db, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return models.User{}, ErrInvalidCredentials
		}
		return models.User{}, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return models.User{}, ErrInvalidCredentials
	}

	return user, nil
}

func ChangeUserPassword(db *gorm.DB, userID uint, currentPassword, newPassword string) error {
	user, err := repository.GetUserById(db, userID)
	if err != nil {
		return err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(currentPassword)); err != nil {
		return ErrCurrentPassword
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	return repository.ChangePassword(db, userID, string(hashedPassword))
}
