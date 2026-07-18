package livekit

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"tester/internal/models"

	"github.com/livekit/protocol/auth"
	livekitprotocol "github.com/livekit/protocol/livekit"
)

type JoinCredentials struct {
	ServerURL string
	Token     string
}

func RoomName(callID string) string {
	callID = strings.TrimSpace(callID)
	if callID != "" && len(callID) <= 96 && isSafeIdentifier(callID) {
		return "call-" + callID
	}
	digest := sha256.Sum256([]byte(callID))
	return "call-" + hex.EncodeToString(digest[:])
}

func ParticipantIdentity(userID uint, sessionID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(sessionID)))
	return fmt.Sprintf("user-%d-session-%s", userID, hex.EncodeToString(digest[:8]))
}

func (s *Service) CreateJoinCredentials(call models.CallLog, userID uint, sessionID string) (JoinCredentials, error) {
	if s == nil || userID == 0 || strings.TrimSpace(sessionID) == "" {
		return JoinCredentials{}, fmt.Errorf("invalid livekit participant")
	}

	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     RoomName(call.CallID),
	}
	grant.SetCanPublish(true)
	grant.SetCanSubscribe(true)
	grant.SetCanPublishData(false)
	grant.SetCanUpdateOwnMetadata(false)

	sources := []livekitprotocol.TrackSource{livekitprotocol.TrackSource_MICROPHONE}
	if call.CallType == models.CallTypeVideo {
		sources = append(sources, livekitprotocol.TrackSource_CAMERA)
	}
	grant.SetCanPublishSources(sources)

	token, err := auth.NewAccessToken(s.apiKey, s.apiSecret).
		SetVideoGrant(grant).
		SetIdentity(ParticipantIdentity(userID, sessionID)).
		SetValidFor(s.tokenTTL).
		ToJWT()
	if err != nil {
		return JoinCredentials{}, err
	}

	return JoinCredentials{
		ServerURL: s.publicURL,
		Token:     token,
	}, nil
}

func isSafeIdentifier(value string) bool {
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z':
		case character >= 'A' && character <= 'Z':
		case character >= '0' && character <= '9':
		case character == '-', character == '_':
		default:
			return false
		}
	}
	return true
}
