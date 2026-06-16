package rabbit

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"tester/internal/dto"

	amqp "github.com/rabbitmq/amqp091-go"
)

const notificationsQueue = "notifications"

var (
	ErrNotConfigured = errors.New("rabbitmq is not configured")
	defaultPublisher *Publisher
	defaultMu        sync.RWMutex
)

type Publisher struct {
	url  string
	conn *amqp.Connection
	mu   sync.Mutex
}

func Init(url string) error {
	publisher := &Publisher{url: url}

	defaultMu.Lock()
	if defaultPublisher != nil {
		_ = defaultPublisher.Close()
	}
	defaultPublisher = publisher
	defaultMu.Unlock()

	return publisher.connect()
}

func Close() error {
	defaultMu.Lock()
	publisher := defaultPublisher
	defaultPublisher = nil
	defaultMu.Unlock()

	if publisher == nil {
		return nil
	}
	return publisher.Close()
}

func PublishNotification(req dto.CreateNotificationReq) error {
	defaultMu.RLock()
	publisher := defaultPublisher
	defaultMu.RUnlock()

	if publisher == nil {
		return ErrNotConfigured
	}

	return publisher.PublishNotification(req)
}

func (p *Publisher) PublishNotification(req dto.CreateNotificationReq) error {
	ch, err := p.openChannel()
	if err != nil {
		return err
	}
	defer ch.Close()

	if _, err := ch.QueueDeclare(notificationsQueue, true, false, false, false, nil); err != nil {
		return err
	}
	if err := ch.Confirm(false); err != nil {
		return err
	}
	confirms := ch.NotifyPublish(make(chan amqp.Confirmation, 1))

	body, err := json.Marshal(req)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := ch.PublishWithContext(ctx, "", notificationsQueue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	}); err != nil {
		return err
	}

	select {
	case confirmation := <-confirms:
		if !confirmation.Ack {
			return errors.New("rabbitmq did not confirm notification publish")
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Publisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == nil || p.conn.IsClosed() {
		return nil
	}
	return p.conn.Close()
}

func (p *Publisher) openChannel() (*amqp.Channel, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.url == "" {
		return nil, ErrNotConfigured
	}

	if p.conn == nil || p.conn.IsClosed() {
		conn, err := amqp.Dial(p.url)
		if err != nil {
			return nil, err
		}
		p.conn = conn
	}

	ch, err := p.conn.Channel()
	if err != nil {
		_ = p.conn.Close()
		p.conn = nil
		return nil, err
	}

	return ch, nil
}

func (p *Publisher) connect() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.url == "" {
		return ErrNotConfigured
	}

	conn, err := amqp.Dial(p.url)
	if err != nil {
		return err
	}

	p.conn = conn
	return nil
}
