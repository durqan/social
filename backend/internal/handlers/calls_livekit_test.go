package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	livekitservice "tester/internal/livekit"
	"tester/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/livekit/protocol/auth"
	livekitprotocol "github.com/livekit/protocol/livekit"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const (
	testLiveKitKey    = "test-key"
	testLiveKitSecret = "test-livekit-secret-at-least-thirty-two-characters"
	testLiveKitURL    = "wss://livekit.example.test"
)

func TestLiveKitTokenCallerAndRecipient(t *testing.T) {
	db, service, call := liveKitTokenTestSetup(t, models.CallStatusAccepted, models.CallTypeVideo)

	for _, userID := range []uint{call.CallerID, call.CalleeID} {
		t.Run(fmt.Sprintf("user_%d", userID), func(t *testing.T) {
			response := requestLiveKitToken(t, db, service, call.CallID, userID, fmt.Sprintf("session-%d", userID), "")
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
			body := decodeTokenResponse(t, response)
			if body.ServerURL != testLiveKitURL || body.Token == "" {
				t.Fatalf("response = %#v", body)
			}

			registered, grants := verifyJoinToken(t, body.Token)
			if grants.Identity != livekitservice.ParticipantIdentity(userID, fmt.Sprintf("session-%d", userID)) {
				t.Fatalf("identity = %q", grants.Identity)
			}
			if grants.Video == nil ||
				!grants.Video.RoomJoin ||
				grants.Video.RoomAdmin ||
				grants.Video.Room != livekitservice.RoomName(call.CallID) ||
				!grants.Video.GetCanPublish() ||
				!grants.Video.GetCanSubscribe() ||
				grants.Video.GetCanPublishData() {
				t.Fatalf("unexpected grants: %#v", grants.Video)
			}
			sources := grants.Video.GetCanPublishSources()
			if len(sources) != 2 ||
				sources[0] != livekitprotocol.TrackSource_MICROPHONE ||
				sources[1] != livekitprotocol.TrackSource_CAMERA {
				t.Fatalf("publish sources = %#v", sources)
			}
			if registered.ExpiresAt == nil || registered.IssuedAt == nil ||
				registered.ExpiresAt.Sub(registered.IssuedAt.Time) > 5*time.Minute {
				t.Fatalf("token lifetime is not short: iat=%v exp=%v", registered.IssuedAt, registered.ExpiresAt)
			}
			if strings.Contains(response.Body.String(), testLiveKitSecret) {
				t.Fatal("API secret leaked in token response")
			}
		})
	}
}

func TestLiveKitTokenForbiddenForOutsider(t *testing.T) {
	db, service, call := liveKitTokenTestSetup(t, models.CallStatusAccepted, models.CallTypeAudio)
	response := requestLiveKitToken(t, db, service, call.CallID, 3, "outsider-session", "")
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestLiveKitTokenDeniedForTerminalCalls(t *testing.T) {
	for _, status := range []string{models.CallStatusEnded, models.CallStatusRejected} {
		t.Run(status, func(t *testing.T) {
			db, service, call := liveKitTokenTestSetup(t, status, models.CallTypeAudio)
			response := requestLiveKitToken(t, db, service, call.CallID, call.CallerID, "caller-session", "")
			if response.Code != http.StatusGone {
				t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestLiveKitTokenIgnoresSpoofedRoomAndIdentity(t *testing.T) {
	db, service, call := liveKitTokenTestSetup(t, models.CallStatusAccepted, models.CallTypeAudio)
	spoofed := `{"room_name":"foreign-room","identity":"admin"}`
	response := requestLiveKitToken(t, db, service, call.CallID, call.CallerID, "real-session", spoofed)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}

	body := decodeTokenResponse(t, response)
	_, grants := verifyJoinToken(t, body.Token)
	if grants.Identity == "admin" || grants.Video.Room == "foreign-room" {
		t.Fatalf("client-controlled token claims: identity=%q room=%q", grants.Identity, grants.Video.Room)
	}
	if grants.Identity != livekitservice.ParticipantIdentity(call.CallerID, "real-session") ||
		grants.Video.Room != livekitservice.RoomName(call.CallID) {
		t.Fatalf("derived claims: identity=%q room=%q", grants.Identity, grants.Video.Room)
	}
	sources := grants.Video.GetCanPublishSources()
	if len(sources) != 1 || sources[0] != livekitprotocol.TrackSource_MICROPHONE {
		t.Fatalf("audio call publish sources = %#v", sources)
	}
	if grants.Video.GetCanUpdateOwnMetadata() {
		t.Fatal("token unexpectedly allows participant metadata updates")
	}
	if strings.Contains(response.Body.String(), testLiveKitSecret) {
		t.Fatal("API secret leaked in response")
	}
}

type tokenResponseBody struct {
	ServerURL string `json:"server_url"`
	Token     string `json:"token"`
}

func liveKitTokenTestSetup(t *testing.T, status, callType string) (*gorm.DB, *livekitservice.Service, models.CallLog) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.CallLog{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []uint{1, 2, 3} {
		if err := db.Create(&models.User{
			ID:       id,
			Name:     fmt.Sprintf("User %d", id),
			Email:    fmt.Sprintf("user%d@example.test", id),
			Password: "x",
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	call := models.CallLog{
		CallID:     "call-token-test",
		CallerID:   1,
		CalleeID:   2,
		CallType:   callType,
		Status:     status,
		StartedAt:  now,
		AcceptedAt: &now,
	}
	if err := db.Create(&call).Error; err != nil {
		t.Fatal(err)
	}

	service, err := livekitservice.NewService(
		"http://livekit:7880",
		testLiveKitURL,
		testLiveKitKey,
		testLiveKitSecret,
	)
	if err != nil {
		t.Fatal(err)
	}
	return db, service, call
}

func requestLiveKitToken(
	t *testing.T,
	db *gorm.DB,
	service *livekitservice.Service,
	callID string,
	userID uint,
	sessionID string,
	body string,
) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/calls/"+callID+"/token", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request
	context.Params = gin.Params{{Key: "callId", Value: callID}}
	context.Set("user_id", userID)
	context.Set("session_id", sessionID)

	GetLiveKitToken(db, service)(context)
	return response
}

func decodeTokenResponse(t *testing.T, response *httptest.ResponseRecorder) tokenResponseBody {
	t.Helper()
	var body tokenResponseBody
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func verifyJoinToken(t *testing.T, rawToken string) (*jwt.RegisteredClaims, *auth.ClaimGrants) {
	t.Helper()
	verifier, err := auth.ParseAPIToken(rawToken)
	if err != nil {
		t.Fatal(err)
	}
	registered, grants, err := verifier.Verify(testLiveKitSecret)
	if err != nil {
		t.Fatal(err)
	}
	return registered, grants
}
