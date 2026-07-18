package handlers

import "testing"

func TestWebsocketRegistrySetReportsOnlyFirstClientOnline(t *testing.T) {
	registry := newWebsocketRegistry()
	first, becameOnline := registry.set(10, nil)
	if first == nil || !becameOnline {
		t.Fatalf("first set returned client=%v becameOnline=%v", first, becameOnline)
	}
	second, becameOnline := registry.set(10, nil)
	if second == nil || becameOnline {
		t.Fatalf("second set returned client=%v becameOnline=%v", second, becameOnline)
	}
}

func TestWebsocketRegistryRemoveReportsOnlyLastClientOffline(t *testing.T) {
	registry := newWebsocketRegistry()
	first := &websocketClient{userID: 10}
	second := &websocketClient{userID: 10}

	registry.clients[10] = map[*websocketClient]struct{}{
		first:  {},
		second: {},
	}

	removed, offline := registry.remove(10, first)
	if !removed {
		t.Fatal("expected first client to be removed")
	}
	if offline {
		t.Fatal("expected user to stay online while another client remains")
	}

	removed, offline = registry.remove(10, second)
	if !removed {
		t.Fatal("expected second client to be removed")
	}
	if !offline {
		t.Fatal("expected user to be offline after last client is removed")
	}
}

func TestWebsocketRegistryRemoveIsIdempotent(t *testing.T) {
	registry := newWebsocketRegistry()
	client := &websocketClient{userID: 10}
	registry.clients[10] = map[*websocketClient]struct{}{client: {}}

	removed, offline := registry.remove(10, client)
	if !removed || !offline {
		t.Fatalf("expected first remove to remove last client, got removed=%v offline=%v", removed, offline)
	}

	removed, offline = registry.remove(10, client)
	if removed || offline {
		t.Fatalf("expected second remove to be a no-op, got removed=%v offline=%v", removed, offline)
	}
}

func TestWebsocketRegistryTracksActiveConversationPerClient(t *testing.T) {
	registry := newWebsocketRegistry()
	first := &websocketClient{userID: 10}
	second := &websocketClient{userID: 10}

	registry.clients[10] = map[*websocketClient]struct{}{
		first:  {},
		second: {},
	}

	if !registry.setActiveConversation(10, first, 20) {
		t.Fatal("expected active conversation update to succeed")
	}
	if first.activeConversationID != 20 {
		t.Fatal("expected first client to mark conversation active")
	}

	if !registry.setActiveConversation(10, first, 0) {
		t.Fatal("expected active conversation clear to succeed")
	}
	if first.activeConversationID != 0 {
		t.Fatal("expected active conversation to clear for first client")
	}

	if !registry.setActiveConversation(10, second, 30) {
		t.Fatal("expected second client active conversation update to succeed")
	}
	if second.activeConversationID != 30 {
		t.Fatal("expected second client to track its own active conversation")
	}
	if !registry.hasActiveConversation(10, 30) {
		t.Fatal("expected active conversation lookup across connections")
	}
	if registry.hasActiveConversation(10, 20) {
		t.Fatal("cleared conversation remained active")
	}

	registry.remove(10, second)
	if registry.hasActiveConversation(10, 30) {
		t.Fatal("removed connection remained active")
	}
	if len(registry.getAll(10)) != 1 {
		t.Fatal("expected removed client to leave the registry")
	}
}
