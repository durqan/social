package services

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"notifications/dto"
	"notifications/models"
)

// Note: incoming_call handling (title/body/tag/URL + CallID propagation) is covered
// in TestBuildPushPayloadFallbackTypesUnchanged.

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
	if payload.Tag != "conversation:2" {
		t.Fatalf("payload.Tag = %q, want %q", payload.Tag, "conversation:2")
	}
	if payload.ConversationID != 2 {
		t.Fatalf("payload.ConversationID = %d, want %d", payload.ConversationID, 2)
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
			if payload.Tag != "conversation:2" {
				t.Fatalf("payload.Tag = %q, want %q", payload.Tag, "conversation:2")
			}
			if payload.ConversationID != 2 {
				t.Fatalf("payload.ConversationID = %d, want %d", payload.ConversationID, 2)
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
			if payload.Tag != "messages" {
				t.Fatalf("payload.Tag = %q, want %q", payload.Tag, "messages")
			}
			if payload.ConversationID != 0 {
				t.Fatalf("payload.ConversationID = %d, want %d", payload.ConversationID, 0)
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
		wantTag      string
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
			wantTag:   "friends",
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
			wantTag:   "friends",
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
			wantTag:   "activity",
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
			wantTag:   "activity",
		},
		{
			name: "incoming call (fallback, no name resolution)",
			notification: models.Notification{
				ID:             99,
				RecipientID:    1,
				ActorID:        42,
				Type:           dto.NotificationTypeIncomingCall,
				EntityID:       0,
				CallID:         "call-uuid-123",
				ConversationID: 42,
				CreatedAt:      time.Date(2025, 4, 1, 12, 0, 0, 0, time.UTC),
			},
			wantTitle: "Входящий звонок",
			wantBody:  "Вам звонит пользователь",
			wantURL:   "/users/1/chat/42?incomingCall=1&callId=call-uuid-123&ts=1743508800000",
			wantTag:   "call-call-uuid-123",
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
			if payload.Tag != tt.wantTag {
				t.Fatalf("payload.Tag = %q, want %q", payload.Tag, tt.wantTag)
			}
			// For incoming_call we intentionally propagate ConversationID (the peer).
			// For classic activity/friend types we expect it to stay 0 in the fallback path.
			if tt.notification.Type == dto.NotificationTypeIncomingCall {
				if payload.ConversationID != tt.notification.ConversationID {
					t.Fatalf("payload.ConversationID = %d, want %d", payload.ConversationID, tt.notification.ConversationID)
				}
				if payload.CallID != tt.notification.CallID {
					t.Fatalf("payload.CallID = %q, want %q", payload.CallID, tt.notification.CallID)
				}
			} else if payload.ConversationID != 0 {
				t.Fatalf("payload.ConversationID = %d, want %d", payload.ConversationID, 0)
			}
		})
	}
}

// TestIncomingCallWithNameResolution verifies that when a real user is found we produce
// a nice body like "Ivan звонит вам" and still produce correct call-* tag + deep link.
func TestIncomingCallWithNameResolution(t *testing.T) {
	ds := fakePushPayloadDataSource{
		users: map[uint]models.User{
			42: {ID: 42, Name: "  Ivan Petrov  "},
		},
	}

	created := time.Date(2025, 4, 10, 10, 0, 0, 0, time.UTC)
	note := models.Notification{
		ID:             101,
		RecipientID:    1,
		ActorID:        42,
		Type:           dto.NotificationTypeIncomingCall,
		EntityID:       0,
		CallID:         "abc-123-def",
		ConversationID: 42,
		CreatedAt:      created,
	}

	payload := buildPushPayload(note, ds)

	if payload.Title != "Входящий звонок" {
		t.Fatalf("title = %q", payload.Title)
	}
	if payload.Body != "Ivan Petrov звонит вам" {
		t.Fatalf("body = %q, want name-resolved body", payload.Body)
	}
	if payload.CallID != "abc-123-def" {
		t.Fatalf("call_id = %q", payload.CallID)
	}
	if payload.ConversationID != 42 {
		t.Fatalf("conversation_id = %d", payload.ConversationID)
	}
	if payload.Tag != "call-abc-123-def" {
		t.Fatalf("tag = %q, want call- based on callId", payload.Tag)
	}
	expectedTs := created.UnixMilli()
	expectedURL := fmt.Sprintf("/users/1/chat/42?incomingCall=1&callId=abc-123-def&ts=%d", expectedTs)
	if payload.URL != expectedURL {
		t.Fatalf("url = %q, want %q", payload.URL, expectedURL)
	}
}

// TestIncomingCallFallbackTagWhenNoCallID ensures that when callId is empty we still
// produce a usable tag based on conversationId (and do not fall back to generic "call").
func TestIncomingCallFallbackTagWhenNoCallID(t *testing.T) {
	note := models.Notification{
		ID:             102,
		RecipientID:    1,
		ActorID:        99,
		Type:           dto.NotificationTypeIncomingCall,
		CallID:         "", // empty on purpose
		ConversationID: 77,
		CreatedAt:      time.Now(),
	}

	payload := buildPushPayload(note, nil)

	if payload.Tag != "call-77" {
		t.Fatalf("tag with empty callId = %q, want call-77 (conversation fallback)", payload.Tag)
	}
	if !strings.Contains(payload.URL, "incomingCall=1") || !strings.Contains(payload.URL, "/chat/77") {
		t.Fatalf("url should contain deep link with conversation id, got %q", payload.URL)
	}
}
