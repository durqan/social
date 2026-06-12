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
