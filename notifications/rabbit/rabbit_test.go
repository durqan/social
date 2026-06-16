package rabbit

import (
	"errors"
	"testing"

	amqp "github.com/rabbitmq/amqp091-go"
)

func TestRetryCountReadsRabbitHeaderNumericTypes(t *testing.T) {
	tests := []struct {
		name    string
		headers amqp.Table
		want    int
	}{
		{name: "missing", headers: amqp.Table{}, want: 0},
		{name: "int32", headers: amqp.Table{retryCountHeader: int32(2)}, want: 2},
		{name: "int64", headers: amqp.Table{retryCountHeader: int64(3)}, want: 3},
		{name: "float64", headers: amqp.Table{retryCountHeader: float64(1)}, want: 1},
		{name: "invalid", headers: amqp.Table{retryCountHeader: "2"}, want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := retryCount(tt.headers); got != tt.want {
				t.Fatalf("retryCount() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestCloneHeadersDoesNotMutateOriginal(t *testing.T) {
	original := amqp.Table{"existing": "value"}
	cloned := cloneHeaders(original)
	cloned[retryCountHeader] = int32(1)

	if _, ok := original[retryCountHeader]; ok {
		t.Fatal("cloneHeaders mutated original headers")
	}
}

func TestConsumeDeliveriesReturnsStoppedWhenChannelCloses(t *testing.T) {
	deliveries := make(chan amqp.Delivery)
	close(deliveries)

	err := consumeDeliveries(nil, deliveries, nil, nil)
	if !errors.Is(err, ErrConsumerStopped) {
		t.Fatalf("consumeDeliveries() error = %v, want %v", err, ErrConsumerStopped)
	}
}

func TestConsumerStatusReflectsLiveness(t *testing.T) {
	consumer := NewConsumerWithURL("amqp://example", nil)
	if status := consumer.Status(); status.Healthy {
		t.Fatal("new consumer should not be healthy before connection")
	}

	consumer.setConnected()
	status := consumer.Status()
	if !status.Healthy || !status.Connected || !status.Consuming {
		t.Fatalf("connected consumer status = %+v, want healthy connected consuming", status)
	}

	consumer.setDisconnected(ErrConsumerStopped)
	status = consumer.Status()
	if status.Healthy || status.Connected || status.Consuming {
		t.Fatalf("disconnected consumer status = %+v, want unhealthy disconnected", status)
	}
	if status.LastError == "" {
		t.Fatal("expected last error after disconnected consumer")
	}
}
