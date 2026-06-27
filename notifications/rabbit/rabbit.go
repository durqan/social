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
	"sync"
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

var ErrConsumerStopped = errors.New("rabbit consumer delivery channel closed")

type ConsumerStatus struct {
	Connected           bool       `json:"connected"`
	Consuming           bool       `json:"consuming"`
	Healthy             bool       `json:"healthy"`
	Reconnects          uint64     `json:"reconnects"`
	Processed           uint64     `json:"processed"`
	Retried             uint64     `json:"retried"`
	DeadLettered        uint64     `json:"dead_lettered"`
	LastError           string     `json:"last_error,omitempty"`
	LastDeadLetterCause string     `json:"last_dead_letter_cause,omitempty"`
	LastConnectedAt     *time.Time `json:"last_connected_at,omitempty"`
	LastDisconnectedAt  *time.Time `json:"last_disconnected_at,omitempty"`
	LastMessageAt       *time.Time `json:"last_message_at,omitempty"`
}

type Consumer struct {
	url           string
	svc           *services.Service
	retryMinDelay time.Duration
	retryMaxDelay time.Duration

	mu                  sync.RWMutex
	connected           bool
	consuming           bool
	reconnects          uint64
	processed           uint64
	retried             uint64
	deadLettered        uint64
	lastError           string
	lastDeadLetterCause string
	lastConnectedAt     *time.Time
	lastDisconnectedAt  *time.Time
	lastMessageAt       *time.Time
}

func NewConsumer(svc *services.Service) *Consumer {
	rabbitURL := os.Getenv("RABBIT_URL")
	if rabbitURL == "" {
		rabbitURL = defaultRabbitURL
	}
	return NewConsumerWithURL(rabbitURL, svc)
}

func NewConsumerWithURL(rabbitURL string, svc *services.Service) *Consumer {
	if rabbitURL == "" {
		rabbitURL = defaultRabbitURL
	}
	return &Consumer{
		url:           rabbitURL,
		svc:           svc,
		retryMinDelay: time.Second,
		retryMaxDelay: 30 * time.Second,
	}
}

func (c *Consumer) Start(ctx context.Context) {
	delay := c.retryMinDelay

	for {
		if ctx.Err() != nil {
			c.setDisconnected(ctx.Err())
			return
		}

		conn, ch, err := newRabbit(c.url)
		if err != nil {
			c.setDisconnected(err)
			log.Printf("rabbit consumer connect failed: error=%v retry_in=%s", err, delay)
			if !sleepWithContext(ctx, delay) {
				return
			}
			delay = nextDelay(delay, c.retryMaxDelay)
			continue
		}

		c.setConnected()
		log.Println("rabbit consumer connected and starting")
		delay = c.retryMinDelay

		err = startConsumer(ch, c.svc, c)
		_ = ch.Close()
		_ = conn.Close()

		if ctx.Err() != nil {
			c.setDisconnected(ctx.Err())
			return
		}

		if err == nil {
			err = ErrConsumerStopped
		}
		c.setDisconnected(err)
		log.Printf("rabbit consumer stopped: error=%v retry_in=%s", err, delay)
		if !sleepWithContext(ctx, delay) {
			return
		}
		delay = nextDelay(delay, c.retryMaxDelay)
	}
}

func (c *Consumer) Status() ConsumerStatus {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return ConsumerStatus{
		Connected:           c.connected,
		Consuming:           c.consuming,
		Healthy:             c.connected && c.consuming,
		Reconnects:          c.reconnects,
		Processed:           c.processed,
		Retried:             c.retried,
		DeadLettered:        c.deadLettered,
		LastError:           c.lastError,
		LastDeadLetterCause: c.lastDeadLetterCause,
		LastConnectedAt:     cloneTimePtr(c.lastConnectedAt),
		LastDisconnectedAt:  cloneTimePtr(c.lastDisconnectedAt),
		LastMessageAt:       cloneTimePtr(c.lastMessageAt),
	}
}

func (c *Consumer) setConnected() {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connected = true
	c.consuming = true
	c.reconnects++
	c.lastError = ""
	c.lastConnectedAt = &now
}

func (c *Consumer) setDisconnected(err error) {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connected = false
	c.consuming = false
	c.lastDisconnectedAt = &now
	if err != nil && !errors.Is(err, context.Canceled) {
		c.lastError = err.Error()
	}
}

func (c *Consumer) recordProcessed() {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.processed++
	c.lastMessageAt = &now
}

func (c *Consumer) recordRetry(cause error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.retried++
	if cause != nil {
		c.lastError = cause.Error()
	}
}

func (c *Consumer) recordDeadLetter(reason string, cause error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deadLettered++
	c.lastDeadLetterCause = reason
	if cause != nil {
		c.lastError = cause.Error()
	}
}

func NewRabbit() (*amqp.Connection, *amqp.Channel, error) {
	rabbitURL := os.Getenv("RABBIT_URL")
	if rabbitURL == "" {
		rabbitURL = defaultRabbitURL
	}
	return newRabbit(rabbitURL)
}

func newRabbit(rabbitURL string) (*amqp.Connection, *amqp.Channel, error) {
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
	return startConsumer(ch, svc, nil)
}

func startConsumer(ch *amqp.Channel, svc *services.Service, recorder *Consumer) error {
	consume, err := ch.Consume(notificationsQueue, "", false,
		false, false, false, nil)
	if err != nil {
		return err
	}

	return consumeDeliveries(ch, consume, svc, recorder)
}

func consumeDeliveries(ch *amqp.Channel, deliveries <-chan amqp.Delivery, svc *services.Service, recorder *Consumer) error {
	for msg := range deliveries {
		var req dto.CreateNotificationReq

		if err := json.Unmarshal(msg.Body, &req); err != nil {
			deadLetter(ch, msg, "invalid_json", err, recorder)
			continue
		}

		if err := validateNotificationReq(req); err != nil {
			deadLetter(ch, msg, "invalid_payload", err, recorder)
			continue
		}

		if err := handleNotificationReq(svc, &req); err != nil {
			retryOrDeadLetter(ch, msg, err, recorder)
			continue
		}

		msg.Ack(false)
		if recorder != nil {
			recorder.recordProcessed()
		}
	}
	return ErrConsumerStopped
}

func sleepWithContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextDelay(current time.Duration, maxDelay time.Duration) time.Duration {
	if current <= 0 {
		current = time.Second
	}
	next := current * 2
	if next > maxDelay {
		return maxDelay
	}
	return next
}

func cloneTimePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
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
		dto.NotificationTypeIncomingCall,
		dto.NotificationTypeCallEnded,
		dto.NotificationTypeCallRejected,
		dto.NotificationTypeCallMissed:
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

func retryOrDeadLetter(ch *amqp.Channel, msg amqp.Delivery, cause error, recorder *Consumer) {
	retries := retryCount(msg.Headers)
	if retries >= maxRetries {
		deadLetter(ch, msg, "max_retries_exceeded", cause, recorder)
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

	if recorder != nil {
		recorder.recordRetry(cause)
	}
	log.Printf("notification event retry scheduled: retries=%d error=%v", retries+1, cause)
	_ = msg.Ack(false)
}

func deadLetter(ch *amqp.Channel, msg amqp.Delivery, reason string, cause error, recorder *Consumer) {
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

	if recorder != nil {
		recorder.recordDeadLetter(reason, cause)
	}
	log.Printf("notification event sent to DLQ: reason=%s error=%v", reason, cause)
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
