package notifications

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"tester/internal/messagecrypto"
	"tester/internal/models"

	"gorm.io/gorm"
)

const (
	TypePostLiked      = "post_liked"
	TypeCommentCreated = "comment_created"
	TypeFriendRequest  = "friend_request"
	TypeFriendAccepted = "friend_accepted"
	TypeMessage        = "message_received"
	TypeIncomingCall   = "incoming_call"
	TypeCallEnded      = "call_ended"
	TypeCallRejected   = "call_rejected"
	TypeCallMissed     = "call_missed"

	ActionCreate               = "create"
	ActionMarkConversationRead = "mark_conversation_read"
)

var (
	ErrInvalidCursor     = errors.New("invalid notification cursor")
	ErrInvalidJob        = errors.New("invalid notification job")
	ErrInvalidPushToken  = errors.New("invalid mobile push token")
	ErrPermanentDelivery = errors.New(
		"permanent notification delivery failure",
	)
)

type Job struct {
	Action         string
	RecipientID    uint
	ActorID        uint
	Type           string
	EntityID       uint
	CallID         string
	ConversationID uint
	CallType       string
}

type MarkReadRequest struct {
	Types          []string `json:"types"`
	ActorID        *uint    `json:"actor_id,omitempty"`
	EntityID       *uint    `json:"entity_id,omitempty"`
	ConversationID *uint    `json:"conversation_id,omitempty"`
}

type MarkSeenRequest struct {
	IDs []uint `json:"ids"`
}

type MobilePushTokenRequest struct {
	Provider string `json:"provider" binding:"required"`
	Platform string `json:"platform" binding:"required"`
	Token    string `json:"token" binding:"required"`
}

type Page struct {
	Notifications []models.Notification
	NextCursor    string
	UnseenCount   int64
}

type cursorPayload struct {
	UserID    uint      `json:"u"`
	CreatedAt time.Time `json:"t"`
	ID        uint      `json:"i"`
}

type Service struct {
	repo                 *repository
	push                 *FCMClient
	isActiveConversation func(userID uint, conversationID uint) bool
}

func NewService(
	database *gorm.DB,
	activeConversationCheck ...func(userID uint, conversationID uint) bool,
) *Service {
	service := &Service{
		repo: newRepository(database),
		push: newFCMClientFromEnv(),
	}
	if len(activeConversationCheck) > 0 {
		service.isActiveConversation = activeConversationCheck[0]
	}
	return service
}

func (s *Service) Process(ctx context.Context, job Job) error {
	if err := validateJob(job); err != nil {
		return fmt.Errorf("%w: %w", ErrPermanentDelivery, err)
	}
	if notificationAction(job.Action) == ActionMarkConversationRead {
		return s.markMessageConversationRead(ctx, job.RecipientID, job.ConversationID)
	}
	return s.createAndPush(ctx, job)
}

func validateJob(job Job) error {
	switch notificationAction(job.Action) {
	case ActionMarkConversationRead:
		if job.RecipientID == 0 || job.ConversationID == 0 {
			return fmt.Errorf("%w: recipient_id and conversation_id are required", ErrInvalidJob)
		}
		return nil
	case ActionCreate:
	default:
		return fmt.Errorf("%w: unsupported action %q", ErrInvalidJob, job.Action)
	}

	if job.RecipientID == 0 || job.ActorID == 0 {
		return fmt.Errorf("%w: recipient_id and actor_id are required", ErrInvalidJob)
	}
	switch strings.TrimSpace(job.Type) {
	case TypePostLiked,
		TypeCommentCreated,
		TypeFriendRequest,
		TypeFriendAccepted,
		TypeMessage,
		TypeIncomingCall,
		TypeCallEnded,
		TypeCallRejected,
		TypeCallMissed:
		return nil
	default:
		return fmt.Errorf("%w: unsupported type %q", ErrInvalidJob, job.Type)
	}
}

func notificationAction(action string) string {
	if action = strings.TrimSpace(action); action != "" {
		return action
	}
	return ActionCreate
}

func (s *Service) createAndPush(ctx context.Context, job Job) error {
	note := models.Notification{
		RecipientID:    job.RecipientID,
		ActorID:        job.ActorID,
		Type:           job.Type,
		EntityID:       job.EntityID,
		CallID:         strings.TrimSpace(job.CallID),
		ConversationID: job.ConversationID,
		CallType:       job.CallType,
		DedupeKey:      DedupeKey(job),
	}

	created, err := s.repo.createOnce(ctx, &note)
	if err != nil {
		return err
	}
	if !created {
		note, err = s.repo.findByDedupeKey(ctx, note.DedupeKey)
		if err != nil {
			return err
		}
	}
	if note.IsRead {
		return nil
	}

	isRead, err := s.repo.isNotificationRead(ctx, note.ID)
	if err != nil {
		return err
	}
	if isRead {
		return nil
	}
	if note.Type == TypeMessage && s.isActiveConversation != nil {
		conversationID := note.ConversationID
		if conversationID == 0 {
			conversationID = note.ActorID
		}
		if s.isActiveConversation(note.RecipientID, conversationID) {
			log.Printf(
				"notification push suppressed for active conversation: notification_id=%d user_id=%d conversation_id=%d",
				note.ID,
				note.RecipientID,
				conversationID,
			)
			return nil
		}
	}

	return s.sendPushPayload(ctx, note.RecipientID, s.buildPushPayload(ctx, note))
}

func DedupeKey(job Job) string {
	raw := fmt.Sprintf(
		"recipient:%d|actor:%d|type:%s|entity:%d|call:%s|conversation:%d",
		job.RecipientID,
		job.ActorID,
		job.Type,
		job.EntityID,
		strings.TrimSpace(job.CallID),
		job.ConversationID,
	)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (s *Service) SaveMobilePushToken(
	ctx context.Context,
	userID uint,
	request MobilePushTokenRequest,
) error {
	request.Provider = strings.ToLower(strings.TrimSpace(request.Provider))
	request.Platform = strings.ToLower(strings.TrimSpace(request.Platform))
	request.Token = strings.TrimSpace(request.Token)
	if userID == 0 ||
		request.Provider != "fcm" ||
		request.Platform != "android" ||
		request.Token == "" {
		return ErrInvalidPushToken
	}

	return s.repo.upsertMobilePushToken(ctx, &models.MobilePushToken{
		UserID:   userID,
		Provider: request.Provider,
		Platform: request.Platform,
		Token:    request.Token,
	})
}

func (s *Service) RevokeMobilePushToken(
	ctx context.Context,
	userID uint,
	request MobilePushTokenRequest,
) error {
	provider := strings.ToLower(strings.TrimSpace(request.Provider))
	if provider == "" {
		provider = "fcm"
	}
	return s.repo.revokeMobilePushToken(
		ctx,
		userID,
		provider,
		strings.TrimSpace(request.Token),
	)
}

func (s *Service) GetPage(
	ctx context.Context,
	userID uint,
	limit int,
	encodedCursor string,
) (Page, error) {
	var cursor *notificationCursor
	if encodedCursor != "" {
		decoded, err := decodeCursor(encodedCursor, userID)
		if err != nil {
			return Page{}, err
		}
		cursor = decoded
	}
	items, hasMore, err := s.repo.findPageByRecipientID(ctx, userID, limit, cursor)
	if err != nil {
		return Page{}, err
	}
	unseenCount, err := s.repo.countUnseen(ctx, userID)
	if err != nil {
		return Page{}, err
	}
	page := Page{Notifications: items, UnseenCount: unseenCount}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		page.NextCursor, err = encodeCursor(
			userID,
			notificationCursor{CreatedAt: last.CreatedAt, ID: last.ID},
		)
	}
	return page, err
}

func encodeCursor(userID uint, cursor notificationCursor) (string, error) {
	if userID == 0 || cursor.ID == 0 || cursor.CreatedAt.IsZero() {
		return "", ErrInvalidCursor
	}
	payload, err := json.Marshal(cursorPayload{
		UserID:    userID,
		CreatedAt: cursor.CreatedAt,
		ID:        cursor.ID,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeCursor(encoded string, userID uint) (*notificationCursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, ErrInvalidCursor
	}
	var decoded cursorPayload
	if err := json.Unmarshal(payload, &decoded); err != nil ||
		decoded.UserID != userID ||
		decoded.ID == 0 ||
		decoded.CreatedAt.IsZero() {
		return nil, ErrInvalidCursor
	}
	return &notificationCursor{CreatedAt: decoded.CreatedAt, ID: decoded.ID}, nil
}

func (s *Service) MarkAsRead(ctx context.Context, id uint, userID uint) error {
	return s.repo.markAsRead(ctx, id, userID)
}

func (s *Service) MarkAsSeen(ctx context.Context, userID uint, ids []uint) error {
	return s.repo.markAsSeen(ctx, userID, ids)
}

func (s *Service) MarkMatchingAsRead(
	ctx context.Context,
	userID uint,
	request MarkReadRequest,
) error {
	return s.repo.markMatchingAsRead(
		ctx,
		userID,
		request.Types,
		request.ActorID,
		request.EntityID,
		request.ConversationID,
	)
}

func (s *Service) markMessageConversationRead(
	ctx context.Context,
	userID uint,
	conversationID uint,
) error {
	if err := s.repo.markMessageConversationRead(ctx, userID, conversationID); err != nil {
		return err
	}
	return s.sendPushPayload(ctx, userID, Payload{
		Tag:            buildMessageTag(conversationID),
		Type:           "notification_sync",
		ConversationID: conversationID,
		SyncAction:     "message_read",
		Silent:         true,
	})
}

func (s *Service) sendPushPayload(ctx context.Context, userID uint, payload Payload) error {
	if s.push == nil || !s.push.Enabled() {
		return nil
	}

	tokens, err := s.repo.findMobilePushTokensByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("load mobile push tokens: %w", err)
	}
	uniqueTokens := uniqueMobilePushTokens(tokens)
	log.Printf(
		"notification push: notification_id=%d user_id=%d tokens=%d unique_tokens=%d",
		payload.NotificationID,
		userID,
		len(tokens),
		len(uniqueTokens),
	)

	successfulSends := 0
	var transientFailure error
	var permanentFailure error
	for _, token := range uniqueTokens {
		err := s.push.SendMobile(ctx, token, payload)
		if err == nil {
			successfulSends++
			continue
		}
		if errors.Is(err, ErrMobileTokenInvalid) {
			if revokeErr := s.repo.revokeMobilePushTokenByID(ctx, token.ID); revokeErr != nil {
				return fmt.Errorf("revoke invalid FCM token %d: %w", token.ID, revokeErr)
			}
			log.Printf("revoked invalid FCM token: token_id=%d user_id=%d", token.ID, userID)
			continue
		}
		if isPermanentFCMError(err) {
			if permanentFailure == nil {
				permanentFailure = fmt.Errorf("send FCM push to token %d: %w", token.ID, err)
			}
			continue
		}
		if transientFailure == nil {
			transientFailure = fmt.Errorf("send FCM push to token %d: %w", token.ID, err)
		}
	}
	if permanentFailure != nil {
		return fmt.Errorf("%w: %w", ErrPermanentDelivery, permanentFailure)
	}
	if transientFailure != nil {
		if successfulSends > 0 {
			log.Printf(
				"notification push partially failed without outbox replay to avoid duplicate delivery: notification_id=%d user_id=%d successful_tokens=%d error=%v",
				payload.NotificationID,
				userID,
				successfulSends,
				transientFailure,
			)
			return nil
		}
		return transientFailure
	}
	return nil
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

func (s *Service) buildPushPayload(ctx context.Context, notification models.Notification) Payload {
	payload := Payload{
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

	if notification.Type == TypeMessage {
		return s.buildMessagePushPayload(ctx, notification, payload)
	}
	if isCallNotification(notification.Type) {
		return s.buildCallPushPayload(ctx, notification, payload)
	}
	return payload
}

func (s *Service) buildMessagePushPayload(
	ctx context.Context,
	notification models.Notification,
	fallback Payload,
) Payload {
	conversationID := notification.ConversationID
	if conversationID == 0 {
		conversationID = notification.ActorID
	}
	fallback.ConversationID = conversationID
	fallback.Tag = buildMessageTag(conversationID)

	message, err := s.repo.findMessageByID(ctx, notification.EntityID)
	if err != nil {
		return fallback
	}
	actor, err := s.repo.findUserByID(ctx, notification.ActorID)
	if err != nil {
		return fallback
	}
	if title := strings.TrimSpace(actor.Name); title != "" {
		fallback.Title = title
	}
	if body := messagePreview(message); body != "" {
		fallback.Body = body
	}
	return fallback
}

func (s *Service) buildCallPushPayload(
	ctx context.Context,
	notification models.Notification,
	fallback Payload,
) Payload {
	fallback.Title = callPushTitle(notification.Type)
	conversationID := notification.ConversationID
	if conversationID == 0 {
		conversationID = notification.ActorID
	}
	fallback.ConversationID = conversationID
	fallback.CallID = notification.CallID
	fallback.Tag = buildTag(notification, conversationID)

	actor, err := s.repo.findUserByID(ctx, notification.ActorID)
	name := strings.TrimSpace(actor.Name)
	if err != nil || name == "" {
		fallback.Body = callPushFallbackBody(notification.Type)
		return fallback
	}
	switch notification.Type {
	case TypeCallEnded:
		fallback.Body = fmt.Sprintf("%s завершил звонок", name)
	case TypeCallRejected:
		fallback.Body = fmt.Sprintf("%s отклонил звонок", name)
	case TypeCallMissed:
		fallback.Body = fmt.Sprintf("Пропущенный звонок от %s", name)
	default:
		fallback.Body = fmt.Sprintf("%s звонит вам", name)
	}
	return fallback
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

	if content := strings.TrimSpace(message.Content); content != "" {
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

func isCallNotification(notificationType string) bool {
	return notificationType == TypeIncomingCall ||
		notificationType == TypeCallEnded ||
		notificationType == TypeCallRejected ||
		notificationType == TypeCallMissed
}

func pushTitle(notificationType string) string {
	switch notificationType {
	case TypeMessage:
		return "Новое сообщение"
	case TypeFriendRequest:
		return "Новая заявка в друзья"
	case TypeFriendAccepted:
		return "Заявка принята"
	case TypePostLiked:
		return "Новый лайк"
	case TypeCommentCreated:
		return "Новый комментарий"
	case TypeIncomingCall:
		return "Входящий звонок"
	case TypeCallEnded:
		return "Звонок завершен"
	case TypeCallRejected:
		return "Звонок отклонен"
	case TypeCallMissed:
		return "Пропущенный звонок"
	default:
		return "Новое уведомление"
	}
}

func pushBody(notificationType string) string {
	switch notificationType {
	case TypeMessage:
		return "Вам написали новое сообщение"
	case TypeFriendRequest:
		return "Вам отправили заявку в друзья"
	case TypeFriendAccepted:
		return "Вашу заявку в друзья приняли"
	case TypePostLiked:
		return "Ваш пост лайкнули"
	case TypeCommentCreated:
		return "Ваш пост прокомментировали"
	case TypeIncomingCall:
		return "Вам звонит пользователь"
	case TypeCallEnded:
		return "Звонок завершен"
	case TypeCallRejected:
		return "Звонок отклонен"
	case TypeCallMissed:
		return "У вас пропущенный звонок"
	default:
		return "Откройте приложение, чтобы посмотреть"
	}
}

func callPushTitle(notificationType string) string {
	switch notificationType {
	case TypeCallEnded:
		return "Звонок завершен"
	case TypeCallRejected:
		return "Звонок отклонен"
	case TypeCallMissed:
		return "Пропущенный звонок"
	default:
		return "Входящий звонок"
	}
}

func callPushFallbackBody(notificationType string) string {
	switch notificationType {
	case TypeCallEnded:
		return "Звонок завершен"
	case TypeCallRejected:
		return "Звонок отклонен"
	case TypeCallMissed:
		return "У вас пропущенный звонок"
	default:
		return "Вам звонит пользователь"
	}
}

func buildTag(notification models.Notification, conversationID uint) string {
	if notification.Type == TypeMessage {
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
	case TypeFriendRequest, TypeFriendAccepted:
		return "friends"
	case TypePostLiked, TypeCommentCreated:
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
