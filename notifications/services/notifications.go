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

func (s *Service) GetUserNotifications(userID uint) ([]models.Notification, error) {
	return s.repo.FindByRecipientID(userID)
}

func (s *Service) MarkAsRead(id uint) error {
	return s.repo.MarkAsRead(id)
}

func (s *Service) sendPushNotifications(notification models.Notification) {
	if s.push == nil || !s.push.Enabled() {
		return
	}

	subscriptions, err := s.repo.FindPushSubscriptionsByUserID(notification.RecipientID)
	if err != nil {
		log.Printf("failed to load push subscriptions: %v", err)
		return
	}

	payload := buildPushPayload(notification)
	for _, subscription := range subscriptions {
		if err := s.push.Send(subscription, payload); err != nil {
			log.Printf("failed to send push notification to subscription %d: %v", subscription.ID, err)

			if errors.Is(err, pushsvc.ErrSubscriptionInvalid) {
				if deleteErr := s.repo.DeletePushSubscription(subscription.ID); deleteErr != nil {
					log.Printf("failed to delete invalid push subscription %d: %v", subscription.ID, deleteErr)
				}
			}
		}
	}
}

func buildPushPayload(notification models.Notification) pushsvc.Payload {
	return pushsvc.Payload{
		Title:          pushTitle(notification.Type),
		Body:           pushBody(notification.Type),
		URL:            pushURL(notification),
		Tag:            fmt.Sprintf("notification-%d", notification.ID),
		NotificationID: notification.ID,
		Type:           notification.Type,
		EntityID:       notification.EntityID,
		ActorID:        notification.ActorID,
	}
}

func pushTitle(notificationType string) string {
	switch notificationType {
	case "message_received":
		return "Новое сообщение"
	case "friend_request":
		return "Новая заявка в друзья"
	case "friend_accepted":
		return "Заявка принята"
	case "post_liked":
		return "Новый лайк"
	case "comment_created":
		return "Новый комментарий"
	default:
		return "Новое уведомление"
	}
}

func pushBody(notificationType string) string {
	switch notificationType {
	case "message_received":
		return "Вам написали новое сообщение"
	case "friend_request":
		return "Вам отправили заявку в друзья"
	case "friend_accepted":
		return "Вашу заявку в друзья приняли"
	case "post_liked":
		return "Ваш пост лайкнули"
	case "comment_created":
		return "Ваш пост прокомментировали"
	default:
		return "Откройте приложение, чтобы посмотреть"
	}
}

func pushURL(notification models.Notification) string {
	switch notification.Type {
	case "message_received":
		return fmt.Sprintf("/users/%d/chat/%d", notification.RecipientID, notification.ActorID)
	case "friend_request":
		return fmt.Sprintf("/users/%d/friends", notification.RecipientID)
	case "friend_accepted":
		return fmt.Sprintf("/users/%d", notification.ActorID)
	case "post_liked", "comment_created":
		return fmt.Sprintf("/users/%d/wall", notification.RecipientID)
	default:
		return fmt.Sprintf("/users/%d", notification.RecipientID)
	}
}
