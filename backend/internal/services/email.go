package services

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
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

	"github.com/wneessen/go-mail"
	"gorm.io/gorm"
)

var sendEmailMessage = sendConfiguredEmail

func SetEmailSenderForTest(sender func(to, subject, htmlBody, textBody string) error) func() {
	previous := sendEmailMessage
	sendEmailMessage = sender
	return func() {
		sendEmailMessage = previous
	}
}

func SendVerificationEmail(db *gorm.DB, user *models.User) error {
	token, err := utils.GenerateVerificationToken()
	if err != nil {
		return fmt.Errorf("failed to generate token: %w", err)
	}

	if err := repository.CreateEmailVerification(db, user.ID, token); err != nil {
		return fmt.Errorf("failed to create email verification: %w", err)
	}

	verifyURL := fmt.Sprintf("%sverify-email/%s", mobileDeepLinkPrefix(), url.PathEscape(token))

	htmlBody := fmt.Sprintf(`<h2>Привет, %s!</h2>
				<p>Спасибо за регистрацию.</p>
				<p>Чтобы подтвердить email, перейдите по ссылке:</p>
				<p><a href="%s">%s</a></p>
				<p>Ссылка действует 2 часа.</p>`, user.Name, verifyURL, verifyURL)
	textBody := "Привет, " + user.Name + "!\nПерейди по ссылке: " + verifyURL

	return sendEmailMessage(user.Email, "Подтвердите ваш email — Social", htmlBody, textBody)
}

func SendPasswordResetEmail(user *models.User, token string) error {
	resetURL := fmt.Sprintf("%sreset-password?token=%s", mobileDeepLinkPrefix(), url.QueryEscape(token))
	htmlBody := fmt.Sprintf(`<h2>Привет, %s!</h2>
				<p>Мы получили запрос на восстановление пароля.</p>
				<p>Чтобы задать новый пароль, перейдите по ссылке:</p>
				<p><a href="%s">%s</a></p>
				<p>Ссылка действует 30 минут и может быть использована только один раз.</p>
				<p>Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>`, user.Name, resetURL, resetURL)
	textBody := "Привет, " + user.Name + "!\nВосстановить пароль: " + resetURL + "\nСсылка действует 30 минут."

	return sendEmailMessage(user.Email, "Восстановление пароля — Social", htmlBody, textBody)
}

type resendEmailRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

func sendConfiguredEmail(to, subject, htmlBody, textBody string) error {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_PROVIDER")))

	switch provider {
	case "", "resend":
		return sendResendEmail(to, subject, htmlBody, textBody)
	case "gmail", "smtp":
		return sendSMTPEmail(to, subject, htmlBody, textBody)
	default:
		return fmt.Errorf("unsupported EMAIL_PROVIDER: %s", provider)
	}
}

func sendResendEmail(to, subject, htmlBody, textBody string) error {
	apiKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	if apiKey == "" {
		return errors.New("RESEND_API_KEY is not configured")
	}

	from := strings.TrimSpace(os.Getenv("EMAIL_FROM"))
	if from == "" {
		from = "Social <no-reply@mail.durqan.ru>"
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

	request, err := http.NewRequest(
		http.MethodPost,
		"https://api.resend.com/emails",
		bytes.NewReader(requestBody),
	)
	if err != nil {
		return fmt.Errorf("failed to create Resend request: %w", err)
	}

	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")

	client := &http.Client{
		Timeout: 20 * time.Second,
	}

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("failed to call Resend API: %w", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	if err != nil {
		return fmt.Errorf("failed to read Resend response: %w", err)
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"Resend API returned %s: %s",
			response.Status,
			strings.TrimSpace(string(responseBody)),
		)
	}

	return nil
}

func sendSMTPEmail(to, subject, htmlBody, textBody string) error {
	username := os.Getenv("GMAIL_USERNAME")
	password := os.Getenv("GMAIL_PASSWORD")

	if username == "" || password == "" {
		return fmt.Errorf("GMAIL_USERNAME or GMAIL_PASSWORD not set in .env")
	}

	m := mail.NewMsg()
	m.From(username)
	m.To(to)
	m.Subject(subject)

	m.SetBodyString(mail.TypeTextHTML, htmlBody)
	m.SetBodyString(mail.TypeTextPlain, textBody)

	client, err := mail.NewClient("smtp.gmail.com",
		mail.WithPort(587),
		mail.WithSMTPAuth(mail.SMTPAuthLogin),
		mail.WithUsername(username),
		mail.WithPassword(password),
		mail.WithTLSPolicy(mail.TLSMandatory),
	)
	if err != nil {
		return fmt.Errorf("failed to create mail client: %w", err)
	}

	if err = client.DialAndSend(m); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
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
	prefix := strings.TrimSpace(os.Getenv("MOBILE_DEEP_LINK_PREFIX"))
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
