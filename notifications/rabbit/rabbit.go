package rabbit

import (
	"encoding/json"
	"notifications/dto"
	"notifications/services"
	"os"

	amqp "github.com/rabbitmq/amqp091-go"
)

const defaultRabbitURL = "amqp://guest:guest@localhost:5672/"

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
	_, err = ch.QueueDeclare("notifications", true, false, false, false, nil)
	if err != nil {
		return nil, nil, err
	}

	return conn, ch, nil
}

func StartConsumer(ch *amqp.Channel, svc *services.Service) error {
	consume, err := ch.Consume("notifications", "", false,
		false, false, false, nil)
	if err != nil {
		return err
	}

	for msg := range consume {
		var req dto.CreateNotificationReq

		if err := json.Unmarshal(msg.Body, &req); err != nil {
			msg.Nack(false, false)
			continue
		}

		if err := svc.CreateNotification(&req); err != nil {
			msg.Nack(false, true)
			continue
		}

		msg.Ack(false)
	}
	return nil
}
