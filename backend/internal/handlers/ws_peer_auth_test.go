package handlers

import (
	"encoding/json"
	"testing"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAuthorizeRealtimePeerEvent(t *testing.T) {
	db := newRealtimePeerAuthTestDB(t)
	previousDB := dbInstance
	dbInstance = db
	t.Cleanup(func() {
		dbInstance = previousDB
	})

	if err := db.Create(&models.Friendship{UserID: 1, FriendID: 2, Status: "accepted"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Friendship{UserID: 1, FriendID: 3, Status: "pending"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&models.Friendship{UserID: 1, FriendID: 4, Status: "blocked"}).Error; err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name    string
		fromID  uint
		payload map[string]uint
		wantID  uint
		wantOK  bool
	}{
		{
			name:    "accepted outgoing direction",
			fromID:  1,
			payload: map[string]uint{"to_id": 2},
			wantID:  2,
			wantOK:  true,
		},
		{
			name:    "accepted reverse direction",
			fromID:  2,
			payload: map[string]uint{"to_id": 1},
			wantID:  1,
			wantOK:  true,
		},
		{
			name:    "pending rejected",
			fromID:  1,
			payload: map[string]uint{"to_id": 3},
			wantOK:  false,
		},
		{
			name:    "blocked rejected",
			fromID:  1,
			payload: map[string]uint{"to_id": 4},
			wantOK:  false,
		},
		{
			name:    "missing friendship rejected",
			fromID:  1,
			payload: map[string]uint{"to_id": 5},
			wantOK:  false,
		},
		{
			name:    "zero recipient rejected",
			fromID:  1,
			payload: map[string]uint{"to_id": 0},
			wantOK:  false,
		},
		{
			name:    "self recipient rejected",
			fromID:  1,
			payload: map[string]uint{"to_id": 1},
			wantOK:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawPayload, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatal(err)
			}

			gotID, gotOK := authorizeRealtimePeerEvent(tt.fromID, rawPayload, "typing:start")
			if gotOK != tt.wantOK {
				t.Fatalf("authorizeRealtimePeerEvent ok = %v, want %v", gotOK, tt.wantOK)
			}
			if gotID != tt.wantID {
				t.Fatalf("authorizeRealtimePeerEvent toID = %d, want %d", gotID, tt.wantID)
			}
		})
	}
}

func TestAuthorizeRealtimePeerEventRejectsMalformedPayload(t *testing.T) {
	db := newRealtimePeerAuthTestDB(t)
	previousDB := dbInstance
	dbInstance = db
	t.Cleanup(func() {
		dbInstance = previousDB
	})

	toID, ok := authorizeRealtimePeerEvent(1, []byte("{"), "call:offer")
	if ok {
		t.Fatal("authorizeRealtimePeerEvent accepted malformed payload")
	}
	if toID != 0 {
		t.Fatalf("authorizeRealtimePeerEvent toID = %d, want 0", toID)
	}
}

func newRealtimePeerAuthTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.Friendship{}); err != nil {
		t.Fatal(err)
	}
	return db
}
