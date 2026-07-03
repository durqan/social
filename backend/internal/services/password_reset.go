package services

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/utils"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const ForgotPasswordSuccessMessage = "Если email существует, мы отправили ссылку для восстановления пароля"

var ErrInvalidPasswordResetToken = errors.New("invalid or expired password reset token")

func RequestPasswordReset(db *gorm.DB, email string) error {
	user, err := repository.GetUserByEmail(db, strings.TrimSpace(email))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	token, err := CreatePasswordResetToken(db, user.ID)
	if err != nil {
		return err
	}

	return SendPasswordResetEmail(&user, token)
}

func CreatePasswordResetToken(db *gorm.DB, userID uint) (string, error) {
	token, err := utils.GenerateSecureToken()
	if err != nil {
		return "", err
	}

	tokenHash := HashPasswordResetToken(token)
	expiresAt := time.Now().Add(models.PasswordResetTokenTTL)
	if err := repository.CreatePasswordResetToken(db, userID, tokenHash, expiresAt); err != nil {
		return "", err
	}

	return token, nil
}

func HashPasswordResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func ResetPassword(db *gorm.DB, rawToken string, newPassword string) (uint, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return 0, ErrInvalidPasswordResetToken
	}

	tokenHash := HashPasswordResetToken(rawToken)
	var userID uint

	err := db.Transaction(func(tx *gorm.DB) error {
		resetToken, err := repository.FindPasswordResetTokenByHash(tx, tokenHash)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvalidPasswordResetToken
			}
			return err
		}

		now := time.Now()
		if resetToken.UsedAt != nil || !now.Before(resetToken.ExpiresAt) {
			return ErrInvalidPasswordResetToken
		}

		used, err := repository.MarkPasswordResetTokenUsed(tx, resetToken.ID, now)
		if err != nil {
			return err
		}
		if !used {
			return ErrInvalidPasswordResetToken
		}

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
		if err != nil {
			return err
		}

		if err := repository.ChangePassword(tx, resetToken.UserID, string(hashedPassword)); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvalidPasswordResetToken
			}
			return err
		}

		userID = resetToken.UserID
		return nil
	})

	if err != nil {
		return 0, err
	}
	return userID, nil
}
