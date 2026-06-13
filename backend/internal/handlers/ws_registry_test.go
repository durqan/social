package handlers

import "testing"

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

	if registry.hasActiveConversation(10, 20) {
		t.Fatal("expected no active conversation before client update")
	}

	if !registry.setActiveConversation(10, first, 20) {
		t.Fatal("expected active conversation update to succeed")
	}
	if !registry.hasActiveConversation(10, 20) {
		t.Fatal("expected first client to mark conversation active")
	}
	if registry.hasActiveConversation(10, 30) {
		t.Fatal("did not expect different conversation to be active")
	}

	if !registry.setActiveConversation(10, first, 0) {
		t.Fatal("expected active conversation clear to succeed")
	}
	if registry.hasActiveConversation(10, 20) {
		t.Fatal("expected active conversation to clear for first client")
	}

	if !registry.setActiveConversation(10, second, 30) {
		t.Fatal("expected second client active conversation update to succeed")
	}
	if !registry.hasActiveConversation(10, 30) {
		t.Fatal("expected second client to track its own active conversation")
	}

	registry.remove(10, second)
	if registry.hasActiveConversation(10, 30) {
		t.Fatal("expected removed client active conversation to be cleared from registry")
	}
}
