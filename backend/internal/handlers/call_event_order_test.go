package handlers

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCallEventOrderDoesNotRejectOutOfOrderSequence(t *testing.T) {
	previous := callEventOrder.seenIDs
	callEventOrder.Lock()
	callEventOrder.seenIDs = make(map[string]time.Time)
	callEventOrder.Unlock()
	t.Cleanup(func() {
		callEventOrder.Lock()
		callEventOrder.seenIDs = previous
		callEventOrder.Unlock()
	})

	if !acceptCallEventOrder(2, "call-1", callEventOrderPayload(t, "ice-1", 3)) {
		t.Fatal("expected first ICE event to be accepted")
	}
	if !acceptCallEventOrder(2, "call-1", callEventOrderPayload(t, "answer-1", 2)) {
		t.Fatal("expected lower sequence answer to be accepted after ICE")
	}
	if acceptCallEventOrder(2, "call-1", callEventOrderPayload(t, "answer-1", 2)) {
		t.Fatal("expected duplicate event_id to be ignored")
	}
}

func callEventOrderPayload(t *testing.T, eventID string, seq int64) map[string]json.RawMessage {
	t.Helper()

	payload := map[string]any{
		"event_id":  eventID,
		"event_seq": seq,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}
