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

const (
	notificationsQueue = "notifications"
	VideoImportsQueue  = "video_imports"
)

var (
	ErrNotConfigured = errors.New("rabbitmq is not configured")
	defaultPublisher *Publisher
	defaultMu        sync.RWMutex
)

type Publisher struct {
	url      string
	conn     *amqp.Connection
	channel  *amqp.Channel
	confirms <-chan amqp.Confirmation
	declared map[string]struct{}
	closed   bool
	mu       sync.Mutex
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

func PublishNotificationContext(ctx context.Context, req dto.CreateNotificationReq) error {
	defaultMu.RLock()
	publisher := defaultPublisher
	defaultMu.RUnlock()

	if publisher == nil {
		return ErrNotConfigured
	}

	return publisher.PublishNotificationContext(ctx, req)
}

func PublishVideoImport(payload any) error {
	defaultMu.RLock()
	publisher := defaultPublisher
	defaultMu.RUnlock()

	if publisher == nil {
		return ErrNotConfigured
	}

	return publisher.PublishJSONContext(context.Background(), VideoImportsQueue, payload)
}

func (p *Publisher) PublishNotificationContext(ctx context.Context, req dto.CreateNotificationReq) error {
	return p.PublishJSONContext(ctx, notificationsQueue, req)
}

func (p *Publisher) PublishJSONContext(ctx context.Context, queue string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureChannelLocked(); err != nil {
		return err
	}
	if err := p.declareQueueLocked(queue); err != nil {
		p.invalidateLocked()
		return err
	}
	if err := p.channel.PublishWithContext(ctx, "", queue, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	}); err != nil {
		p.invalidateLocked()
		return err
	}

	select {
	case confirmation, ok := <-p.confirms:
		if !ok {
			p.invalidateLocked()
			return errors.New("rabbitmq confirm channel closed")
		}
		if !confirmation.Ack {
			return errors.New("rabbitmq did not confirm notification publish")
		}
		return nil
	case <-ctx.Done():
		p.invalidateLocked()
		return ctx.Err()
	}
}

func (p *Publisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.closed = true
	var firstErr error
	if p.channel != nil && !p.channel.IsClosed() {
		firstErr = p.channel.Close()
	}
	p.channel = nil
	p.confirms = nil
	if p.conn != nil && !p.conn.IsClosed() {
		if err := p.conn.Close(); firstErr == nil {
			firstErr = err
		}
	}
	p.conn = nil
	return firstErr
}

func (p *Publisher) ensureChannelLocked() error {
	if p.url == "" {
		return ErrNotConfigured
	}
	if p.closed {
		return errors.New("rabbitmq publisher is closed")
	}

	if p.conn == nil || p.conn.IsClosed() {
		conn, err := amqp.Dial(p.url)
		if err != nil {
			return err
		}
		p.conn = conn
	}
	if p.channel != nil && !p.channel.IsClosed() {
		return nil
	}

	ch, err := p.conn.Channel()
	if err != nil {
		p.invalidateLocked()
		return err
	}
	if err := ch.Confirm(false); err != nil {
		_ = ch.Close()
		p.invalidateLocked()
		return err
	}
	p.channel = ch
	p.confirms = ch.NotifyPublish(make(chan amqp.Confirmation, 1))
	p.declared = make(map[string]struct{})
	return nil
}

func (p *Publisher) connect() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.ensureChannelLocked(); err != nil {
		return err
	}
	for _, queue := range []string{notificationsQueue, VideoImportsQueue} {
		if err := p.declareQueueLocked(queue); err != nil {
			p.invalidateLocked()
			return err
		}
	}
	return nil
}

func (p *Publisher) declareQueueLocked(queue string) error {
	if _, ok := p.declared[queue]; ok {
		return nil
	}
	if _, err := p.channel.QueueDeclare(queue, true, false, false, false, nil); err != nil {
		return err
	}
	p.declared[queue] = struct{}{}
	return nil
}

func (p *Publisher) invalidateLocked() {
	if p.channel != nil && !p.channel.IsClosed() {
		_ = p.channel.Close()
	}
	p.channel = nil
	p.confirms = nil
	p.declared = nil
	if p.conn != nil && !p.conn.IsClosed() {
		_ = p.conn.Close()
	}
	p.conn = nil
}
