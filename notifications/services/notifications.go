package services

import (
	"errors"
	"fmt"
	"log"
	"notifications/dto"
	"notifications/hub"
	"notifications/models"
	pushsvc "notifications/push"
	"notifications/repository"
	"strings"
)

type Service struct {
	repo *repository.Repository
	hub  *hub.Hub
	push *pushsvc.Service
}

func NewService(repo *repository.Repository, hub *hub.Hub, push *pushsvc.Service) *Service {
	return &Service{repo: repo, hub: hub, push: push}
}

func (s *Service) CreateNotification(req *dto.CreateNotificationReq) error {
	note := &models.Notification{
		RecipientID: req.RecipientID,
		ActorID:     req.ActorID,
		Type:        req.Type,
		EntityID:    req.EntityID,
	}

	if err := s.repo.Create(note); err != nil {
		return err
	}

	s.hub.SendToUser(note.RecipientID, *note)
	go s.sendPushNotifications(*note)
	return nil
}

func (s *Service) SavePushSubscription(req *dto.PushSubscriptionReq) error {
	subscription := &models.PushSubscription{
		UserID:   req.UserID,
		Endpoint: req.Endpoint,
		P256DH:   req.Keys.P256DH,
		Auth:     req.Keys.Auth,
	}

	return s.repo.UpsertPushSubscription(subscription)
}

func (s *Service) SaveMobilePushToken(req *dto.MobilePushTokenReq) error {
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	req.Platform = strings.ToLower(strings.TrimSpace(req.Platform))
	req.Token = strings.TrimSpace(req.Token)

	if req.Provider != "fcm" || req.Platform != "android" || req.Token == "" {
		return errors.New("invalid mobile push token")
	}

	return s.repo.UpsertMobilePushToken(&models.MobilePushToken{
		UserID:   req.UserID,
		Provider: req.Provider,
		Platform: req.Platform,
		Token:    req.Token,
	})
}

func (s *Service) RevokeMobilePushToken(userID uint, req dto.MobilePushTokenReq) error {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "fcm"
	}
	return s.repo.RevokeMobilePushToken(userID, provider, strings.TrimSpace(req.Token))
}

func (s *Service) GetUserNotifications(userID uint) ([]models.Notification, error) {
	return s.repo.FindByRecipientID(userID)
}

func (s *Service) MarkAsRead(id uint, userID uint) error {
	return s.repo.MarkAsRead(id, userID)
}

func (s *Service) MarkMatchingAsRead(userID uint, req dto.MarkNotificationsReadReq) error {
	return s.repo.MarkMatchingAsRead(userID, req.Types, req.ActorID, req.EntityID)
}

func (s *Service) sendPushNotifications(notification models.Notification) {
	if s.push == nil || !s.push.Enabled() {
		return
	}

	payload := s.buildPushPayload(notification)

	if s.push.WebPushEnabled() {
		subscriptions, err := s.repo.FindPushSubscriptionsByUserID(notification.RecipientID)
		if err != nil {
			log.Printf("failed to load push subscriptions: %v", err)
		} else {
			for _, subscription := range subscriptions {
				if err := s.push.Send(subscription, payload); err != nil {
					log.Printf("failed to send web push notification to subscription %d: %v", subscription.ID, err)

					if errors.Is(err, pushsvc.ErrSubscriptionInvalid) {
						if deleteErr := s.repo.DeletePushSubscription(subscription.ID); deleteErr != nil {
							log.Printf("failed to delete invalid push subscription %d: %v", subscription.ID, deleteErr)
						}
					}
				}
			}
		}
	}

	if s.push.FCMEnabled() {
		tokens, err := s.repo.FindMobilePushTokensByUserID(notification.RecipientID)
		if err != nil {
			log.Printf("failed to load mobile push tokens: %v", err)
			return
		}

		for _, token := range tokens {
			if err := s.push.SendMobile(token, payload); err != nil {
				log.Printf("failed to send FCM push notification to token %d: %v", token.ID, err)

				if errors.Is(err, pushsvc.ErrMobileTokenInvalid) {
					if revokeErr := s.repo.RevokeMobilePushTokenByID(token.ID); revokeErr != nil {
						log.Printf("failed to revoke invalid FCM token %d: %v", token.ID, revokeErr)
					}
				}
			}
		}
	}
}

type pushPayloadDataSource interface {
	FindMessageByID(id uint) (models.Message, error)
	FindUserByID(id uint) (models.User, error)
}

func (s *Service) buildPushPayload(notification models.Notification) pushsvc.Payload {
	return buildPushPayload(notification, s.repo)
}

func buildPushPayload(notification models.Notification, dataSource pushPayloadDataSource) pushsvc.Payload {
	payload := pushsvc.Payload{
		Title:          pushTitle(notification.Type),
		Body:           pushBody(notification.Type),
		URL:            pushURL(notification),
		Tag:            buildTag(notification, 0),
		NotificationID: notification.ID,
		Type:           notification.Type,
		EntityID:       notification.EntityID,
		ActorID:        notification.ActorID,
	}

	if notification.Type == dto.NotificationTypeMessage {
		return buildMessagePushPayload(notification, dataSource, payload)
	}

	return payload
}

func buildMessagePushPayload(
	notification models.Notification,
	dataSource pushPayloadDataSource,
	fallback pushsvc.Payload,
) pushsvc.Payload {
	if dataSource == nil {
		fb := fallback
		fb.Tag = "messages"
		return fb
	}

	message, err := dataSource.FindMessageByID(notification.EntityID)
	if err != nil {
		fb := fallback
		fb.Tag = "messages"
		return fb
	}

	actor, err := dataSource.FindUserByID(notification.ActorID)
	if err != nil {
		fb := fallback
		fb.Tag = "messages"
		return fb
	}

	payload := fallback
	if title := displayUserName(actor); title != "" {
		payload.Title = title
	}
	if body := messagePreview(message); body != "" {
		payload.Body = body
	}
	convID := notification.ActorID
	payload.ConversationID = convID
	payload.Tag = buildTag(notification, convID)
	return payload
}

func displayUserName(user models.User) string {
	return strings.TrimSpace(user.Name)
}

func messagePreview(message models.Message) string {
	content := strings.TrimSpace(message.Content)
	if content != "" {
		return content
	}

	for _, attachment := range message.Attachments {
		if strings.EqualFold(strings.TrimSpace(attachment.FileType), "image") {
			return "📷 Фотография"
		}
	}
	if len(message.Attachments) > 0 {
		return "📎 Вложение"
	}

	return ""
}

func pushTitle(notificationType string) string {
	switch notificationType {
	case dto.NotificationTypeMessage:
		return "Новое сообщение"
	case dto.NotificationTypeFriendRequest:
		return "Новая заявка в друзья"
	case dto.NotificationTypeFriendAccepted:
		return "Заявка принята"
	case dto.NotificationTypePostLiked:
		return "Новый лайк"
	case dto.NotificationTypeCommentCreated:
		return "Новый комментарий"
	default:
		return "Новое уведомление"
	}
}

func pushBody(notificationType string) string {
	switch notificationType {
	case dto.NotificationTypeMessage:
		return "Вам написали новое сообщение"
	case dto.NotificationTypeFriendRequest:
		return "Вам отправили заявку в друзья"
	case dto.NotificationTypeFriendAccepted:
		return "Вашу заявку в друзья приняли"
	case dto.NotificationTypePostLiked:
		return "Ваш пост лайкнули"
	case dto.NotificationTypeCommentCreated:
		return "Ваш пост прокомментировали"
	default:
		return "Откройте приложение, чтобы посмотреть"
	}
}

func pushURL(notification models.Notification) string {
	switch notification.Type {
	case dto.NotificationTypeMessage:
		return fmt.Sprintf("/users/%d/chat/%d", notification.RecipientID, notification.ActorID)
	case dto.NotificationTypeFriendRequest:
		return fmt.Sprintf("/users/%d/friends", notification.RecipientID)
	case dto.NotificationTypeFriendAccepted:
		return fmt.Sprintf("/users/%d", notification.ActorID)
	case dto.NotificationTypePostLiked, dto.NotificationTypeCommentCreated:
		return fmt.Sprintf("/users/%d/wall", notification.RecipientID)
	default:
		return fmt.Sprintf("/users/%d", notification.RecipientID)
	}
}

func buildTag(notification models.Notification, conversationID uint) string {
	if notification.Type == dto.NotificationTypeMessage {
		if conversationID != 0 {
			return fmt.Sprintf("conversation:%d", conversationID)
		}
		return "messages"
	}
	switch notification.Type {
	case dto.NotificationTypeFriendRequest, dto.NotificationTypeFriendAccepted:
		return "friends"
	case dto.NotificationTypePostLiked, dto.NotificationTypeCommentCreated:
		return "activity"
	default:
		return fmt.Sprintf("notification-%d", notification.ID)
	}
}
