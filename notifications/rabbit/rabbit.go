package rabbit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"notifications/dto"
	"notifications/services"
	"os"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const defaultRabbitURL = "amqp://guest:guest@localhost:5672/"
const notificationsQueue = "notifications"
const notificationsDLQ = "notifications.dlq"
const retryCountHeader = "x-retry-count"
const maxRetries = 3

const (
	actionCreate               = "create"
	actionMarkConversationRead = "mark_conversation_read"
)

func NewRabbit() (*amqp.Connection, *amqp.Channel, error) {
	rabbitURL := os.Getenv("RABBIT_URL")
	if rabbitURL == "" {
		rabbitURL = defaultRabbitURL
	}

	conn, err := amqp.Dial(rabbitURL)
	if err != nil {
		return nil, nil, err
	}
	ch, err := conn.Channel()
	if err != nil {
		return nil, nil, err
	}
	_, err = ch.QueueDeclare(notificationsQueue, true, false, false, false, nil)
	if err != nil {
		return nil, nil, err
	}
	_, err = ch.QueueDeclare(notificationsDLQ, true, false, false, false, nil)
	if err != nil {
		return nil, nil, err
	}

	return conn, ch, nil
}

func StartConsumer(ch *amqp.Channel, svc *services.Service) error {
	consume, err := ch.Consume(notificationsQueue, "", false,
		false, false, false, nil)
	if err != nil {
		return err
	}

	for msg := range consume {
		var req dto.CreateNotificationReq

		if err := json.Unmarshal(msg.Body, &req); err != nil {
			deadLetter(ch, msg, "invalid_json", err)
			continue
		}

		if err := validateNotificationReq(req); err != nil {
			deadLetter(ch, msg, "invalid_payload", err)
			continue
		}

		if err := handleNotificationReq(svc, &req); err != nil {
			retryOrDeadLetter(ch, msg, err)
			continue
		}

		msg.Ack(false)
	}
	return nil
}

func handleNotificationReq(svc *services.Service, req *dto.CreateNotificationReq) error {
	switch notificationAction(req.Action) {
	case actionMarkConversationRead:
		return svc.MarkMessageConversationRead(req.RecipientID, req.ConversationID)
	default:
		return svc.CreateNotification(req)
	}
}

func validateNotificationReq(req dto.CreateNotificationReq) error {
	switch notificationAction(req.Action) {
	case actionMarkConversationRead:
		if req.RecipientID == 0 {
			return errors.New("recipient_id is required")
		}
		if req.ConversationID == 0 {
			return errors.New("conversation_id is required")
		}
		return nil
	case actionCreate:
	default:
		return fmt.Errorf("unsupported notification action %q", req.Action)
	}

	if req.RecipientID == 0 {
		return errors.New("recipient_id is required")
	}
	if req.ActorID == 0 {
		return errors.New("actor_id is required")
	}

	switch strings.TrimSpace(req.Type) {
	case dto.NotificationTypePostLiked,
		dto.NotificationTypeCommentCreated,
		dto.NotificationTypeFriendRequest,
		dto.NotificationTypeFriendAccepted,
		dto.NotificationTypeMessage,
		dto.NotificationTypeIncomingCall:
		return nil
	default:
		return fmt.Errorf("unsupported notification type %q", req.Type)
	}
}

func notificationAction(action string) string {
	action = strings.TrimSpace(action)
	if action == "" {
		return actionCreate
	}
	return action
}

func retryOrDeadLetter(ch *amqp.Channel, msg amqp.Delivery, cause error) {
	retries := retryCount(msg.Headers)
	if retries >= maxRetries {
		deadLetter(ch, msg, "max_retries_exceeded", cause)
		return
	}

	headers := cloneHeaders(msg.Headers)
	headers[retryCountHeader] = int32(retries + 1)
	headers["x-last-error"] = cause.Error()

	if err := publishToQueue(ch, notificationsQueue, msg, headers); err != nil {
		log.Printf("failed to republish notification retry: retries=%d error=%v", retries+1, err)
		_ = msg.Nack(false, true)
		return
	}

	_ = msg.Ack(false)
}

func deadLetter(ch *amqp.Channel, msg amqp.Delivery, reason string, cause error) {
	headers := cloneHeaders(msg.Headers)
	headers["x-death-reason"] = reason
	if cause != nil {
		headers["x-last-error"] = cause.Error()
	}

	if err := publishToQueue(ch, notificationsDLQ, msg, headers); err != nil {
		log.Printf("failed to publish notification to DLQ: reason=%s error=%v", reason, err)
		_ = msg.Nack(false, true)
		return
	}

	_ = msg.Ack(false)
}

func publishToQueue(ch *amqp.Channel, queue string, msg amqp.Delivery, headers amqp.Table) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	contentType := msg.ContentType
	if contentType == "" {
		contentType = "application/json"
	}

	return ch.PublishWithContext(ctx, "", queue, false, false, amqp.Publishing{
		ContentType:  contentType,
		DeliveryMode: amqp.Persistent,
		Headers:      headers,
		Body:         msg.Body,
	})
}

func cloneHeaders(headers amqp.Table) amqp.Table {
	cloned := amqp.Table{}
	for key, value := range headers {
		cloned[key] = value
	}
	return cloned
}

func retryCount(headers amqp.Table) int {
	value, ok := headers[retryCountHeader]
	if !ok {
		return 0
	}

	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case uint:
		return int(typed)
	case uint8:
		return int(typed)
	case uint16:
		return int(typed)
	case uint32:
		return int(typed)
	case uint64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}
