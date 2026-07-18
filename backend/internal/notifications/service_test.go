package notifications

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestProcessCreatesNotificationOnce(t *testing.T) {
	database := newTestDatabase(t)
	service := &Service{repo: newRepository(database)}
	job := Job{
		RecipientID: 10,
		ActorID:     20,
		Type:        TypeMessage,
		EntityID:    30,
	}

	if err := service.Process(context.Background(), job); err != nil {
		t.Fatalf("first Process failed: %v", err)
	}
	if err := service.Process(context.Background(), job); err != nil {
		t.Fatalf("duplicate Process failed: %v", err)
	}

	var count int64
	if err := database.Model(&models.Notification{}).Count(&count).Error; err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 1 {
		t.Fatalf("notification count = %d, want 1", count)
	}
}

func TestProcessSuppressesMessagePushForActiveConversation(t *testing.T) {
	database := newTestDatabase(t)
	if err := database.Create(&models.MobilePushToken{
		UserID: 10, Provider: "fcm", Platform: "android", Token: "token",
	}).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	sends := 0
	service := &Service{
		repo: newRepository(database),
		push: testFCMClient(func(request *http.Request) (*http.Response, error) {
			sends++
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{}`)),
				Header:     make(http.Header),
				Request:    request,
			}, nil
		}),
		isActiveConversation: func(userID uint, conversationID uint) bool {
			return userID == 10 && conversationID == 20
		},
	}

	if err := service.Process(context.Background(), Job{
		RecipientID:    10,
		ActorID:        20,
		Type:           TypeMessage,
		EntityID:       30,
		ConversationID: 20,
	}); err != nil {
		t.Fatalf("Process failed: %v", err)
	}
	if sends != 0 {
		t.Fatalf("FCM sends = %d, want 0 for active conversation", sends)
	}
	var count int64
	if err := database.Model(&models.Notification{}).Count(&count).Error; err != nil {
		t.Fatalf("count notifications: %v", err)
	}
	if count != 1 {
		t.Fatalf("notification count = %d, want persisted notification", count)
	}
}

func TestProcessClassifiesInvalidJobAsPermanent(t *testing.T) {
	service := &Service{repo: newRepository(newTestDatabase(t))}
	err := service.Process(context.Background(), Job{Action: "unsupported"})
	if !errors.Is(err, ErrInvalidJob) || !errors.Is(err, ErrPermanentDelivery) {
		t.Fatalf("Process error = %v, want invalid permanent job", err)
	}
}

func TestProcessReadSyncMarksMatchingNotifications(t *testing.T) {
	database := newTestDatabase(t)
	service := &Service{repo: newRepository(database)}
	items := []models.Notification{
		{
			RecipientID:    10,
			ActorID:        20,
			Type:           TypeMessage,
			EntityID:       1,
			ConversationID: 20,
			DedupeKey:      "matching",
		},
		{
			RecipientID:    10,
			ActorID:        30,
			Type:           TypeMessage,
			EntityID:       2,
			ConversationID: 30,
			DedupeKey:      "other",
		},
	}
	if err := database.Create(&items).Error; err != nil {
		t.Fatalf("seed notifications: %v", err)
	}

	if err := service.Process(context.Background(), Job{
		Action:         ActionMarkConversationRead,
		RecipientID:    10,
		ConversationID: 20,
	}); err != nil {
		t.Fatalf("read sync failed: %v", err)
	}

	var got []models.Notification
	if err := database.Order("entity_id").Find(&got).Error; err != nil {
		t.Fatalf("load notifications: %v", err)
	}
	if !got[0].IsRead || !got[0].IsSeen {
		t.Fatal("matching notification was not marked read and seen")
	}
	if got[1].IsRead || got[1].IsSeen {
		t.Fatal("other conversation notification was changed")
	}
}

func TestMobilePushTokenUpsertReassignsAndReactivatesToken(t *testing.T) {
	database := newTestDatabase(t)
	service := &Service{repo: newRepository(database)}
	request := MobilePushTokenRequest{
		Provider: "fcm",
		Platform: "android",
		Token:    "same-device-token",
	}

	if err := service.SaveMobilePushToken(context.Background(), 10, request); err != nil {
		t.Fatalf("first save failed: %v", err)
	}
	if err := service.RevokeMobilePushToken(context.Background(), 10, request); err != nil {
		t.Fatalf("revoke failed: %v", err)
	}
	if err := service.SaveMobilePushToken(context.Background(), 11, request); err != nil {
		t.Fatalf("second save failed: %v", err)
	}

	var tokens []models.MobilePushToken
	if err := database.Find(&tokens).Error; err != nil {
		t.Fatalf("load tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0].UserID != 11 || tokens[0].RevokedAt != nil {
		t.Fatalf("unexpected token state: %+v", tokens)
	}
}

func TestGetPageScopesCursorAndUnseenCountToUser(t *testing.T) {
	database := newTestDatabase(t)
	service := &Service{repo: newRepository(database)}
	for index := 1; index <= 3; index++ {
		if err := database.Create(&models.Notification{
			RecipientID: 10,
			ActorID:     uint(20 + index),
			Type:        TypeFriendRequest,
			EntityID:    uint(index),
			DedupeKey:   fmt.Sprintf("page-%d", index),
		}).Error; err != nil {
			t.Fatalf("seed notification: %v", err)
		}
	}

	first, err := service.GetPage(context.Background(), 10, 2, "")
	if err != nil {
		t.Fatalf("first page: %v", err)
	}
	if len(first.Notifications) != 2 || first.NextCursor == "" || first.UnseenCount != 3 {
		t.Fatalf("unexpected first page: %+v", first)
	}
	second, err := service.GetPage(context.Background(), 10, 2, first.NextCursor)
	if err != nil {
		t.Fatalf("second page: %v", err)
	}
	if len(second.Notifications) != 1 || second.NextCursor != "" {
		t.Fatalf("unexpected second page: %+v", second)
	}
	if _, err := service.GetPage(context.Background(), 11, 2, first.NextCursor); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("foreign cursor error = %v, want ErrInvalidCursor", err)
	}
}

func TestMessagePushPayloadUsesConversationTagAndEncryptedPreview(t *testing.T) {
	t.Setenv(
		"MESSAGE_ENCRYPTION_KEY",
		"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	)
	database := newTestDatabase(t)
	service := &Service{repo: newRepository(database)}
	if err := database.Create(&models.User{ID: 20, Name: "Sender"}).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}
	ciphertext, nonce := encryptTestMessage(t, "encrypted preview")
	if err := database.Create(&models.Message{
		ID:                30,
		FromID:            20,
		ToID:              10,
		EncryptionVersion: 1,
		Ciphertext:        ciphertext,
		Nonce:             nonce,
	}).Error; err != nil {
		t.Fatalf("seed message: %v", err)
	}

	payload := service.buildPushPayload(context.Background(), models.Notification{
		ID:             40,
		RecipientID:    10,
		ActorID:        20,
		Type:           TypeMessage,
		EntityID:       30,
		ConversationID: 20,
	})
	if payload.Title != "Sender" ||
		payload.Body != "encrypted preview" ||
		payload.Tag != "message:20" {
		t.Fatalf("unexpected payload: %+v", payload)
	}
}

func TestUniqueMobilePushTokensDeduplicatesTokenValue(t *testing.T) {
	tokens := []models.MobilePushToken{
		{ID: 1, Token: "same"},
		{ID: 2, Token: "same"},
		{ID: 3, Token: "other"},
	}
	got := uniqueMobilePushTokens(tokens)
	if len(got) != 2 || got[0].ID != 1 || got[1].ID != 3 {
		t.Fatalf("unique tokens = %+v", got)
	}
}

func TestSendPushRevokesInvalidToken(t *testing.T) {
	database := newTestDatabase(t)
	token := models.MobilePushToken{
		UserID:   10,
		Provider: "fcm",
		Platform: "android",
		Token:    "invalid",
	}
	if err := database.Create(&token).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	service := &Service{
		repo: newRepository(database),
		push: testFCMClient(func(request *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Body: io.NopCloser(
					strings.NewReader(`{"error":{"status":"UNREGISTERED"}}`),
				),
				Header:  make(http.Header),
				Request: request,
			}, nil
		}),
	}

	if err := service.sendPushPayload(
		context.Background(),
		10,
		Payload{Type: TypeFriendRequest},
	); err != nil {
		t.Fatalf("send push: %v", err)
	}
	if err := database.First(&token, token.ID).Error; err != nil {
		t.Fatalf("reload token: %v", err)
	}
	if token.RevokedAt == nil {
		t.Fatal("invalid token was not revoked")
	}
}

func TestSendMobileLeavesTemporaryFCMRetryToOutbox(t *testing.T) {
	database := newTestDatabase(t)
	if err := database.Create(&models.MobilePushToken{
		UserID: 10, Provider: "fcm", Platform: "android", Token: "token",
	}).Error; err != nil {
		t.Fatalf("seed token: %v", err)
	}
	attempts := 0
	service := &Service{
		repo: newRepository(database),
		push: testFCMClient(func(request *http.Request) (*http.Response, error) {
			attempts++
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Body:       io.NopCloser(strings.NewReader(`{"error":"temporary"}`)),
				Header:     make(http.Header),
				Request:    request,
			}, nil
		}),
	}

	err := service.sendPushPayload(
		context.Background(),
		10,
		Payload{Type: TypeMessage},
	)
	if err == nil || attempts != 1 {
		t.Fatalf("error = %v, attempts = %d", err, attempts)
	}
}

func TestSendPushDoesNotReplaySuccessfulTokenAfterPartialFailure(t *testing.T) {
	database := newTestDatabase(t)
	if err := database.Create(&[]models.MobilePushToken{
		{UserID: 10, Provider: "fcm", Platform: "android", Token: "failed"},
		{UserID: 10, Provider: "fcm", Platform: "android", Token: "successful"},
	}).Error; err != nil {
		t.Fatalf("seed tokens: %v", err)
	}
	attempts := map[string]int{}
	service := &Service{
		repo: newRepository(database),
		push: testFCMClient(func(request *http.Request) (*http.Response, error) {
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			token := "successful"
			status := http.StatusOK
			if strings.Contains(string(body), `"token":"failed"`) {
				token = "failed"
				status = http.StatusServiceUnavailable
			}
			attempts[token]++
			return &http.Response{
				StatusCode: status,
				Body:       io.NopCloser(strings.NewReader(`{}`)),
				Header:     make(http.Header),
				Request:    request,
			}, nil
		}),
	}

	if err := service.sendPushPayload(
		context.Background(),
		10,
		Payload{NotificationID: 40, Type: TypeFriendRequest},
	); err != nil {
		t.Fatalf("partial delivery should be finalized without replay: %v", err)
	}
	if attempts["failed"] != 1 || attempts["successful"] != 1 {
		t.Fatalf("attempts = %+v", attempts)
	}
}

func newTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(
		sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := database.AutoMigrate(
		&models.User{},
		&models.Message{},
		&models.MessageAttachment{},
		&models.Notification{},
		&models.MobilePushToken{},
	); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return database
}

func encryptTestMessage(t *testing.T, plaintext string) (string, string) {
	t.Helper()
	key, err := base64.StdEncoding.DecodeString(
		"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
	)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := []byte("123456789012")
	ciphertext := aead.Seal(nil, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ciphertext),
		base64.StdEncoding.EncodeToString(nonce)
}
