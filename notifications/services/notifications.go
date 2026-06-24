package services

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"notifications/dto"
	"notifications/hub"
	"notifications/messagecrypto"
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
		RecipientID:    req.RecipientID,
		ActorID:        req.ActorID,
		Type:           req.Type,
		EntityID:       req.EntityID,
		CallID:         req.CallID,
		ConversationID: req.ConversationID,
		CallType:       req.CallType,
		DedupeKey:      DedupeKey(*req),
	}

	created, err := s.repo.CreateOnce(note)
	if err != nil {
		return err
	}
	if !created {
		return nil
	}
	if note.IsRead {
		return nil
	}

	s.hub.SendToUser(note.RecipientID, *note)
	go s.sendPushNotifications(*note)
	return nil
}

func DedupeKey(req dto.CreateNotificationReq) string {
	raw := fmt.Sprintf(
		"recipient:%d|actor:%d|type:%s|entity:%d|call:%s|conversation:%d",
		req.RecipientID,
		req.ActorID,
		req.Type,
		req.EntityID,
		strings.TrimSpace(req.CallID),
		req.ConversationID,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (s *Service) SavePushSubscription(req *dto.PushSubscriptionReq) error {
	req.Endpoint = strings.TrimSpace(req.Endpoint)
	req.Keys.P256DH = strings.TrimSpace(req.Keys.P256DH)
	req.Keys.Auth = strings.TrimSpace(req.Keys.Auth)
	if req.UserID == 0 || req.Endpoint == "" || req.Keys.P256DH == "" || req.Keys.Auth == "" {
		return errors.New("invalid push subscription")
	}

	subscription := &models.PushSubscription{
		UserID:   req.UserID,
		Endpoint: req.Endpoint,
		P256DH:   req.Keys.P256DH,
		Auth:     req.Keys.Auth,
	}

	return s.repo.UpsertPushSubscription(subscription)
}

func (s *Service) DeletePushSubscription(userID uint, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if userID == 0 || endpoint == "" {
		return errors.New("invalid push subscription")
	}
	return s.repo.DeletePushSubscriptionForUser(userID, endpoint)
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

func (s *Service) MarkAsSeen(userID uint, ids []uint) error {
	return s.repo.MarkAsSeen(userID, ids)
}

func (s *Service) MarkMatchingAsRead(userID uint, req dto.MarkNotificationsReadReq) error {
	return s.repo.MarkMatchingAsRead(userID, req.Types, req.ActorID, req.EntityID, req.ConversationID)
}

func (s *Service) MarkMessageConversationRead(userID uint, conversationID uint) error {
	if err := s.repo.MarkMessageConversationRead(userID, conversationID); err != nil {
		return err
	}
	go s.sendNotificationSync(userID, conversationID)
	return nil
}

func (s *Service) sendPushNotifications(notification models.Notification) {
	if s.push == nil || !s.push.Enabled() {
		return
	}

	if !s.shouldSendPush(notification) {
		return
	}

	payload := s.buildPushPayload(notification)
	s.sendPushPayload(notification.RecipientID, payload)
}

func (s *Service) sendNotificationSync(userID uint, conversationID uint) {
	if s.push == nil || !s.push.Enabled() || userID == 0 || conversationID == 0 {
		return
	}

	s.sendPushPayload(userID, pushsvc.Payload{
		Title:          "",
		Body:           "",
		URL:            "",
		Tag:            buildMessageTag(conversationID),
		Type:           "notification_sync",
		ConversationID: conversationID,
		SyncAction:     "message_read",
		Silent:         true,
	})
}

func (s *Service) shouldSendPush(notification models.Notification) bool {
	isRead, err := s.repo.IsNotificationRead(notification.ID)
	if err == nil && isRead {
		return false
	}

	return true
}

func (s *Service) sendPushPayload(userID uint, payload pushsvc.Payload) {
	if s.push.WebPushEnabled() {
		subscriptions, err := s.repo.FindPushSubscriptionsByUserID(userID)
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
		tokens, err := s.repo.FindMobilePushTokensByUserID(userID)
		if err != nil {
			log.Printf("failed to load mobile push tokens: %v", err)
			return
		}
		uniqueTokens := uniqueMobilePushTokens(tokens)
		log.Printf(
			"info: sending mobile push: notification_id=%d user_id=%d token_count_before_dedupe=%d token_count_after_dedupe=%d platform=fcm/android",
			payload.NotificationID,
			userID,
			len(tokens),
			len(uniqueTokens),
		)

		for _, token := range uniqueTokens {
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

func uniqueMobilePushTokens(tokens []models.MobilePushToken) []models.MobilePushToken {
	if len(tokens) < 2 {
		return tokens
	}

	seen := make(map[string]struct{}, len(tokens))
	unique := make([]models.MobilePushToken, 0, len(tokens))
	for _, token := range tokens {
		if _, ok := seen[token.Token]; ok {
			continue
		}
		seen[token.Token] = struct{}{}
		unique = append(unique, token)
	}
	return unique
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
		CallID:         notification.CallID,
		ConversationID: notification.ConversationID,
		CallType:       notification.CallType,
	}

	if notification.Type == dto.NotificationTypeMessage {
		return buildMessagePushPayload(notification, dataSource, payload)
	}

	if notification.Type == dto.NotificationTypeIncomingCall {
		return buildIncomingCallPushPayload(notification, dataSource, payload)
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
		convID := notification.ConversationID
		if convID == 0 {
			convID = notification.ActorID
		}
		fb.ConversationID = convID
		fb.Tag = buildMessageTag(convID)
		return fb
	}

	message, err := dataSource.FindMessageByID(notification.EntityID)
	if err != nil {
		fb := fallback
		convID := notification.ConversationID
		if convID == 0 {
			convID = notification.ActorID
		}
		fb.ConversationID = convID
		fb.Tag = buildMessageTag(convID)
		return fb
	}

	actor, err := dataSource.FindUserByID(notification.ActorID)
	if err != nil {
		fb := fallback
		convID := notification.ConversationID
		if convID == 0 {
			convID = notification.ActorID
		}
		fb.ConversationID = convID
		fb.Tag = buildMessageTag(convID)
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
	if notification.ConversationID != 0 {
		convID = notification.ConversationID
	}
	payload.ConversationID = convID
	payload.Tag = buildMessageTag(convID)
	return payload
}

// buildIncomingCallPushPayload enriches the payload for call invites.
// We resolve the caller's name (same pattern as messages) so the push can say
// "Ivan Ivanov звонит вам" instead of a generic body.
// The callId is passed through for client-side stale detection and tag uniqueness.
func buildIncomingCallPushPayload(
	notification models.Notification,
	dataSource pushPayloadDataSource,
	fallback pushsvc.Payload,
) pushsvc.Payload {
	payload := fallback
	payload.Title = "Входящий звонок"

	convID := notification.ConversationID
	if convID == 0 {
		convID = notification.ActorID
	}
	payload.ConversationID = convID
	payload.CallID = notification.CallID
	payload.Tag = buildTag(notification, convID)

	if dataSource == nil {
		payload.Body = "Вам звонит пользователь"
		return payload
	}

	actor, err := dataSource.FindUserByID(notification.ActorID)
	if err != nil || displayUserName(actor) == "" {
		payload.Body = "Вам звонит пользователь"
		return payload
	}

	name := displayUserName(actor)
	payload.Body = fmt.Sprintf("%s звонит вам", name)
	return payload
}

func displayUserName(user models.User) string {
	return strings.TrimSpace(user.Name)
}

func messagePreview(message models.Message) string {
	if message.EncryptionVersion > 0 {
		cipher, err := messagecrypto.NewFromEnv()
		if err != nil {
			log.Printf("message preview decrypt failed: message_id=%d error=%v", message.ID, err)
			return "Новое сообщение"
		}
		content, err := cipher.Decrypt(message.Ciphertext, message.Nonce)
		if err != nil {
			log.Printf("message preview decrypt failed: message_id=%d error=%v", message.ID, err)
			return "Новое сообщение"
		}
		return strings.TrimSpace(content)
	}

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
	case dto.NotificationTypeIncomingCall:
		return "Входящий звонок"
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
	case dto.NotificationTypeIncomingCall:
		// Actual body is built in buildIncomingCallPushPayload using the caller's name.
		return "Вам звонит пользователь"
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
	case dto.NotificationTypeIncomingCall:
		// Deep link into the chat with the caller. The query params are used by the PWA
		// to know it arrived from a call push (for stale detection / future auto-accept hints).
		conv := notification.ConversationID
		if conv == 0 {
			conv = notification.ActorID
		}
		ts := notification.CreatedAt.UnixMilli()
		if notification.CallID != "" {
			return fmt.Sprintf("/users/%d/chat/%d?incomingCall=1&callId=%s&ts=%d", notification.RecipientID, conv, notification.CallID, ts)
		}
		return fmt.Sprintf("/users/%d/chat/%d?incomingCall=1&ts=%d", notification.RecipientID, conv, ts)
	default:
		return fmt.Sprintf("/users/%d", notification.RecipientID)
	}
}

func buildTag(notification models.Notification, conversationID uint) string {
	if notification.Type == dto.NotificationTypeMessage {
		if conversationID != 0 {
			return buildMessageTag(conversationID)
		}
		return "messages"
	}
	if notification.Type == dto.NotificationTypeIncomingCall {
		if notification.CallID != "" {
			return fmt.Sprintf("call-%s", notification.CallID)
		}
		if conversationID != 0 {
			return fmt.Sprintf("call-%d", conversationID)
		}
		return "call"
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

func buildMessageTag(conversationID uint) string {
	if conversationID == 0 {
		return "messages"
	}
	return fmt.Sprintf("message:%d", conversationID)
}
