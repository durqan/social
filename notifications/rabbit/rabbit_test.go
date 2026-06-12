package rabbit

import (
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
