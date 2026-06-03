package services

import (
	"errors"
	"testing"

	"notifications/dto"
	"notifications/models"
)

type fakePushPayloadDataSource struct {
	messages   map[uint]models.Message
	users      map[uint]models.User
	messageErr error
	userErr    error
}

func (f fakePushPayloadDataSource) FindMessageByID(id uint) (models.Message, error) {
	if f.messageErr != nil {
		return models.Message{}, f.messageErr
	}
	message, ok := f.messages[id]
	if !ok {
		return models.Message{}, errors.New("message not found")
	}
	return message, nil
}

func (f fakePushPayloadDataSource) FindUserByID(id uint) (models.User, error) {
	if f.userErr != nil {
		return models.User{}, f.userErr
	}
	user, ok := f.users[id]
	if !ok {
		return models.User{}, errors.New("user not found")
	}
	return user, nil
}

func TestBuildPushPayloadMessageReceivedWithText(t *testing.T) {
	notification := models.Notification{
		ID:          10,
		RecipientID: 1,
		ActorID:     2,
		Type:        dto.NotificationTypeMessage,
		EntityID:    3,
	}
	dataSource := fakePushPayloadDataSource{
		messages: map[uint]models.Message{
			3: {ID: 3, Content: "Привет"},
		},
		users: map[uint]models.User{
			2: {ID: 2, Name: "Анна"},
		},
	}

	payload := buildPushPayload(notification, dataSource)

	if payload.Title != "Анна" {
		t.Fatalf("payload.Title = %q, want %q", payload.Title, "Анна")
	}
	if payload.Body != "Привет" {
		t.Fatalf("payload.Body = %q, want %q", payload.Body, "Привет")
	}
	if payload.URL != "/users/1/chat/2" {
		t.Fatalf("payload.URL = %q, want %q", payload.URL, "/users/1/chat/2")
	}
}

func TestBuildPushPayloadMessageReceivedWithEmptyTextAndAttachment(t *testing.T) {
	tests := []struct {
		name       string
		attachment models.MessageAttachment
		wantBody   string
	}{
		{
			name:       "image",
			attachment: models.MessageAttachment{FileType: "image"},
			wantBody:   "📷 Фотография",
		},
		{
			name:       "other attachment",
			attachment: models.MessageAttachment{FileType: "file"},
			wantBody:   "📎 Вложение",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			notification := models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypeMessage,
				EntityID:    3,
			}
			dataSource := fakePushPayloadDataSource{
				messages: map[uint]models.Message{
					3: {
						ID:          3,
						Content:     "   ",
						Attachments: []models.MessageAttachment{tt.attachment},
					},
				},
				users: map[uint]models.User{
					2: {ID: 2, Name: "Анна"},
				},
			}

			payload := buildPushPayload(notification, dataSource)

			if payload.Title != "Анна" {
				t.Fatalf("payload.Title = %q, want %q", payload.Title, "Анна")
			}
			if payload.Body != tt.wantBody {
				t.Fatalf("payload.Body = %q, want %q", payload.Body, tt.wantBody)
			}
		})
	}
}

func TestBuildPushPayloadMessageReceivedFallsBackOnLoadErrors(t *testing.T) {
	tests := []struct {
		name       string
		dataSource fakePushPayloadDataSource
	}{
		{
			name: "message error",
			dataSource: fakePushPayloadDataSource{
				messageErr: errors.New("load message"),
				users: map[uint]models.User{
					2: {ID: 2, Name: "Анна"},
				},
			},
		},
		{
			name: "user error",
			dataSource: fakePushPayloadDataSource{
				messages: map[uint]models.Message{
					3: {ID: 3, Content: "Привет"},
				},
				userErr: errors.New("load user"),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			notification := models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypeMessage,
				EntityID:    3,
			}

			payload := buildPushPayload(notification, tt.dataSource)

			if payload.Title != "Новое сообщение" {
				t.Fatalf("payload.Title = %q, want %q", payload.Title, "Новое сообщение")
			}
			if payload.Body != "Вам написали новое сообщение" {
				t.Fatalf("payload.Body = %q, want %q", payload.Body, "Вам написали новое сообщение")
			}
			if payload.URL != "/users/1/chat/2" {
				t.Fatalf("payload.URL = %q, want %q", payload.URL, "/users/1/chat/2")
			}
		})
	}
}

func TestBuildPushPayloadFallbackTypesUnchanged(t *testing.T) {
	tests := []struct {
		name         string
		notification models.Notification
		wantTitle    string
		wantBody     string
		wantURL      string
	}{
		{
			name: "friend request",
			notification: models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypeFriendRequest,
				EntityID:    3,
			},
			wantTitle: "Новая заявка в друзья",
			wantBody:  "Вам отправили заявку в друзья",
			wantURL:   "/users/1/friends",
		},
		{
			name: "friend accepted",
			notification: models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypeFriendAccepted,
				EntityID:    3,
			},
			wantTitle: "Заявка принята",
			wantBody:  "Вашу заявку в друзья приняли",
			wantURL:   "/users/2",
		},
		{
			name: "post liked",
			notification: models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypePostLiked,
				EntityID:    3,
			},
			wantTitle: "Новый лайк",
			wantBody:  "Ваш пост лайкнули",
			wantURL:   "/users/1/wall",
		},
		{
			name: "comment created",
			notification: models.Notification{
				ID:          10,
				RecipientID: 1,
				ActorID:     2,
				Type:        dto.NotificationTypeCommentCreated,
				EntityID:    3,
			},
			wantTitle: "Новый комментарий",
			wantBody:  "Ваш пост прокомментировали",
			wantURL:   "/users/1/wall",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			payload := buildPushPayload(tt.notification, nil)

			if payload.Title != tt.wantTitle {
				t.Fatalf("payload.Title = %q, want %q", payload.Title, tt.wantTitle)
			}
			if payload.Body != tt.wantBody {
				t.Fatalf("payload.Body = %q, want %q", payload.Body, tt.wantBody)
			}
			if payload.URL != tt.wantURL {
				t.Fatalf("payload.URL = %q, want %q", payload.URL, tt.wantURL)
			}
		})
	}
}
