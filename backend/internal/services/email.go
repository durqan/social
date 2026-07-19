package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"tester/internal/cache"
	"tester/internal/models"
	"tester/internal/repository"
	"tester/internal/utils"

	"gorm.io/gorm"
)

const (
	resendAPIURL     = "https://api.resend.com/emails"
	resendAPITimeout = 20 * time.Second
)

type resendEmailRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

var sendEmailMessage = sendResendEmail

func SetEmailSenderForTest(
	sender func(to, subject, htmlBody, textBody string) error,
) func() {
	previous := sendEmailMessage
	sendEmailMessage = sender

	return func() {
		sendEmailMessage = previous
	}
}

func SendVerificationEmail(db *gorm.DB, user *models.User) error {
	token, err := utils.GenerateVerificationToken()
	if err != nil {
		return fmt.Errorf("failed to generate verification token: %w", err)
	}

	if err := repository.CreateEmailVerification(db, user.ID, token); err != nil {
		return fmt.Errorf("failed to create email verification: %w", err)
	}

	baseURL, err := publicAPIURL()
	if err != nil {
		return err
	}

	verifyURL := fmt.Sprintf(
		"%s/auth/verify-email/%s",
		baseURL,
		url.PathEscape(token),
	)

	escapedName := html.EscapeString(user.Name)
	escapedURL := html.EscapeString(verifyURL)

	htmlBody := fmt.Sprintf(`
		<h2>Привет, %s!</h2>
		<p>Спасибо за регистрацию.</p>
		<p>Чтобы подтвердить email, перейдите по ссылке:</p>
		<p><a href="%s">%s</a></p>
		<p>Ссылка действует 2 часа.</p>
	`, escapedName, escapedURL, escapedURL)

	textBody := fmt.Sprintf(
		"Привет, %s!\n\nЧтобы подтвердить email, перейдите по ссылке:\n%s\n\nСсылка действует 2 часа.",
		user.Name,
		verifyURL,
	)

	return sendEmailMessage(
		user.Email,
		"Подтвердите ваш email — Social",
		htmlBody,
		textBody,
	)
}

func publicAPIURL() (string, error) {
	baseURL := strings.TrimSpace(os.Getenv("PUBLIC_API_URL"))
	if baseURL == "" {
		return "", errors.New("PUBLIC_API_URL is not configured")
	}

	return strings.TrimRight(baseURL, "/"), nil
}

func SendPasswordResetEmail(user *models.User, token string) error {
	resetURL := fmt.Sprintf(
		"%sreset-password?token=%s",
		mobileDeepLinkPrefix(),
		url.QueryEscape(token),
	)

	escapedName := html.EscapeString(user.Name)
	escapedURL := html.EscapeString(resetURL)

	htmlBody := fmt.Sprintf(`
		<h2>Привет, %s!</h2>
		<p>Мы получили запрос на восстановление пароля.</p>
		<p>Чтобы задать новый пароль, перейдите по ссылке:</p>
		<p><a href="%s">%s</a></p>
		<p>Ссылка действует 30 минут и может быть использована только один раз.</p>
		<p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
	`, escapedName, escapedURL, escapedURL)

	textBody := fmt.Sprintf(
		"Привет, %s!\n\nЧтобы восстановить пароль, перейдите по ссылке:\n%s\n\nСсылка действует 30 минут и может быть использована только один раз.",
		user.Name,
		resetURL,
	)

	return sendEmailMessage(
		user.Email,
		"Восстановление пароля — Social",
		htmlBody,
		textBody,
	)
}

func sendResendEmail(
	to string,
	subject string,
	htmlBody string,
	textBody string,
) error {
	apiKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	if apiKey == "" {
		return errors.New("RESEND_API_KEY is not configured")
	}

	from := strings.TrimSpace(os.Getenv("EMAIL_FROM"))
	if from == "" {
		from = "Social <no-reply@mail.durqan.ru>"
	}

	to = strings.TrimSpace(to)
	if to == "" {
		return errors.New("email recipient is empty")
	}

	payload := resendEmailRequest{
		From:    from,
		To:      []string{to},
		Subject: subject,
		HTML:    htmlBody,
		Text:    textBody,
	}

	requestBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to encode Resend request: %w", err)
	}

	ctx, cancel := context.WithTimeout(
		context.Background(),
		resendAPITimeout,
	)
	defer cancel()

	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		resendAPIURL,
		bytes.NewReader(requestBody),
	)
	if err != nil {
		return fmt.Errorf("failed to create Resend request: %w", err)
	}

	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("failed to call Resend API: %w", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(
		io.LimitReader(response.Body, 1024*1024),
	)
	if err != nil {
		return fmt.Errorf("failed to read Resend response: %w", err)
	}

	if response.StatusCode < http.StatusOK ||
		response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf(
			"Resend API returned %s: %s",
			response.Status,
			strings.TrimSpace(string(responseBody)),
		)
	}

	return nil
}

func VerifyEmail(db *gorm.DB, token string) error {
	return db.Transaction(func(tx *gorm.DB) error {
		verification, err := repository.FindEmailVerificationByToken(tx, token)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("invalid or expired verification link")
			}

			return err
		}

		if time.Now().After(verification.ExpiresAt) {
			return errors.New("verification link has expired")
		}

		if verification.Used {
			return errors.New("this link has already been used")
		}

		if err := repository.MarkEmailAsUsed(tx, verification.ID); err != nil {
			return err
		}

		if err := repository.VerifyUserEmail(tx, verification.UserID); err != nil {
			return err
		}

		return nil
	})
}

func mobileDeepLinkPrefix() string {
	prefix := strings.TrimSpace(
		os.Getenv("MOBILE_DEEP_LINK_PREFIX"),
	)

	if prefix == "" {
		prefix = "social://"
	}

	return strings.TrimRight(prefix, "/") + "/"
}

func InvalidateEmailVerificationCaches() {
	if cache.Redis == nil {
		return
	}

	_ = cache.Redis.DeletePattern("cache:/users*")
}
