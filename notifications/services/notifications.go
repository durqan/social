package services

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"notifications/dto"
	"notifications/messagecrypto"
	"notifications/models"
	pushsvc "notifications/push"
	"notifications/repository"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Service struct {
	repo *repository.Repository
	push *pushsvc.Service

	pushJobs  chan pushJob
	pushWG    sync.WaitGroup
	closeOnce sync.Once
}

type pushJob struct {
	notification *models.Notification
	userID       uint
	payload      *pushsvc.Payload
}

var ErrInvalidNotificationCursor = errors.New("invalid notification cursor")

type NotificationPage struct {
	Notifications []models.Notification
	NextCursor    string
	UnseenCount   int64
}

type notificationCursorPayload struct {
	UserID    uint      `json:"u"`
	CreatedAt time.Time `json:"t"`
	ID        uint      `json:"i"`
}

func NewService(repo *repository.Repository, push *pushsvc.Service) *Service {
	service := &Service{repo: repo, push: push}
	if push != nil && push.Enabled() {
		queueSize := serviceEnvInt("PUSH_QUEUE_SIZE", 256, 1, 10000)
		workers := serviceEnvInt("PUSH_WORKERS", 4, 1, 64)
		service.pushJobs = make(chan pushJob, queueSize)
		for i := 0; i < workers; i++ {
			service.pushWG.Add(1)
			go service.runPushWorker()
		}
	}
	return service
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

	s.enqueuePush(pushJob{notification: note})
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

func (s *Service) GetUserNotificationsPage(userID uint, limit int, encodedCursor string) (NotificationPage, error) {
	var cursor *repository.NotificationCursor
	if encodedCursor != "" {
		decoded, err := DecodeNotificationCursor(encodedCursor, userID)
		if err != nil {
			return NotificationPage{}, err
		}
		cursor = decoded
	}
	notifications, hasMore, err := s.repo.FindPageByRecipientID(userID, limit, cursor)
	if err != nil {
		return NotificationPage{}, err
	}
	unseenCount, err := s.repo.CountUnseen(userID)
	if err != nil {
		return NotificationPage{}, err
	}
	page := NotificationPage{Notifications: notifications, UnseenCount: unseenCount}
	if hasMore && len(notifications) > 0 {
		last := notifications[len(notifications)-1]
		page.NextCursor, err = EncodeNotificationCursor(userID, repository.NotificationCursor{CreatedAt: last.CreatedAt, ID: last.ID})
	}
	return page, err
}

func EncodeNotificationCursor(userID uint, cursor repository.NotificationCursor) (string, error) {
	if userID == 0 || cursor.ID == 0 || cursor.CreatedAt.IsZero() {
		return "", ErrInvalidNotificationCursor
	}
	payload, err := json.Marshal(notificationCursorPayload{UserID: userID, CreatedAt: cursor.CreatedAt, ID: cursor.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func DecodeNotificationCursor(encoded string, userID uint) (*repository.NotificationCursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, ErrInvalidNotificationCursor
	}
	var decoded notificationCursorPayload
	if err := json.Unmarshal(payload, &decoded); err != nil || decoded.UserID != userID || decoded.ID == 0 || decoded.CreatedAt.IsZero() {
		return nil, ErrInvalidNotificationCursor
	}
	return &repository.NotificationCursor{CreatedAt: decoded.CreatedAt, ID: decoded.ID}, nil
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
	payload := pushsvc.Payload{
		Title:          "",
		Body:           "",
		Tag:            buildMessageTag(conversationID),
		Type:           "notification_sync",
		ConversationID: conversationID,
		SyncAction:     "message_read",
		Silent:         true,
	}
	s.enqueuePush(pushJob{userID: userID, payload: &payload})
	return nil
}

func (s *Service) enqueuePush(job pushJob) {
	if s.pushJobs == nil {
		return
	}
	// A bounded channel intentionally applies backpressure to Rabbit workers.
	s.pushJobs <- job
}

func (s *Service) runPushWorker() {
	defer s.pushWG.Done()
	for job := range s.pushJobs {
		if job.notification != nil {
			s.sendPushNotifications(*job.notification)
			continue
		}
		if job.payload != nil {
			s.sendPushPayload(job.userID, *job.payload)
		}
	}
}

func (s *Service) Close() {
	s.closeOnce.Do(func() {
		if s.pushJobs != nil {
			close(s.pushJobs)
			s.pushWG.Wait()
		}
	})
}

func serviceEnvInt(name string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
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

func (s *Service) shouldSendPush(notification models.Notification) bool {
	isRead, err := s.repo.IsNotificationRead(notification.ID)
	if err == nil && isRead {
		return false
	}

	return true
}

func (s *Service) sendPushPayload(userID uint, payload pushsvc.Payload) {
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

	if isCallNotification(notification.Type) {
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
	payload.Title = callPushTitle(notification.Type)

	convID := notification.ConversationID
	if convID == 0 {
		convID = notification.ActorID
	}
	payload.ConversationID = convID
	payload.CallID = notification.CallID
	payload.Tag = buildTag(notification, convID)

	if dataSource == nil {
		payload.Body = callPushFallbackBody(notification.Type)
		return payload
	}

	actor, err := dataSource.FindUserByID(notification.ActorID)
	if err != nil || displayUserName(actor) == "" {
		payload.Body = callPushFallbackBody(notification.Type)
		return payload
	}

	name := displayUserName(actor)
	switch notification.Type {
	case dto.NotificationTypeCallEnded:
		payload.Body = fmt.Sprintf("%s завершил звонок", name)
	case dto.NotificationTypeCallRejected:
		payload.Body = fmt.Sprintf("%s отклонил звонок", name)
	case dto.NotificationTypeCallMissed:
		payload.Body = fmt.Sprintf("Пропущенный звонок от %s", name)
	default:
		payload.Body = fmt.Sprintf("%s звонит вам", name)
	}
	return payload
}

func isCallNotification(notificationType string) bool {
	return notificationType == dto.NotificationTypeIncomingCall ||
		notificationType == dto.NotificationTypeCallEnded ||
		notificationType == dto.NotificationTypeCallRejected ||
		notificationType == dto.NotificationTypeCallMissed
}

func callPushTitle(notificationType string) string {
	switch notificationType {
	case dto.NotificationTypeCallEnded:
		return "Звонок завершен"
	case dto.NotificationTypeCallRejected:
		return "Звонок отклонен"
	case dto.NotificationTypeCallMissed:
		return "Пропущенный звонок"
	default:
		return "Входящий звонок"
	}
}

func callPushFallbackBody(notificationType string) string {
	switch notificationType {
	case dto.NotificationTypeCallEnded:
		return "Звонок завершен"
	case dto.NotificationTypeCallRejected:
		return "Звонок отклонен"
	case dto.NotificationTypeCallMissed:
		return "У вас пропущенный звонок"
	default:
		return "Вам звонит пользователь"
	}
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
	case dto.NotificationTypeCallEnded:
		return "Звонок завершен"
	case dto.NotificationTypeCallRejected:
		return "Звонок отклонен"
	case dto.NotificationTypeCallMissed:
		return "Пропущенный звонок"
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
	case dto.NotificationTypeCallEnded:
		return "Звонок завершен"
	case dto.NotificationTypeCallRejected:
		return "Звонок отклонен"
	case dto.NotificationTypeCallMissed:
		return "У вас пропущенный звонок"
	default:
		return "Откройте приложение, чтобы посмотреть"
	}
}

func buildTag(notification models.Notification, conversationID uint) string {
	if notification.Type == dto.NotificationTypeMessage {
		if conversationID != 0 {
			return buildMessageTag(conversationID)
		}
		return "messages"
	}
	if isCallNotification(notification.Type) {
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
