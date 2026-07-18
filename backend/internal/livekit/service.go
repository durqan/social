package livekit

import (
	"context"
	"errors"
	"strings"
	"time"

	livekitprotocol "github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
)

const defaultTokenTTL = 5 * time.Minute

type Service struct {
	internalURL string
	publicURL   string
	apiKey      string
	apiSecret   string
	tokenTTL    time.Duration
	rooms       *lksdk.RoomServiceClient
}

func NewService(internalURL, publicURL, apiKey, apiSecret string) (*Service, error) {
	internalURL = strings.TrimSpace(internalURL)
	publicURL = strings.TrimSpace(publicURL)
	apiKey = strings.TrimSpace(apiKey)
	apiSecret = strings.TrimSpace(apiSecret)
	if internalURL == "" || publicURL == "" || apiKey == "" || apiSecret == "" {
		return nil, errors.New("livekit configuration is incomplete")
	}

	return &Service{
		internalURL: internalURL,
		publicURL:   publicURL,
		apiKey:      apiKey,
		apiSecret:   apiSecret,
		tokenTTL:    defaultTokenTTL,
		rooms:       lksdk.NewRoomServiceClient(internalURL, apiKey, apiSecret),
	}, nil
}

func (s *Service) PublicURL() string {
	if s == nil {
		return ""
	}
	return s.publicURL
}

func (s *Service) CloseRoom(ctx context.Context, callID string) error {
	if s == nil || s.rooms == nil {
		return nil
	}
	_, err := s.rooms.DeleteRoom(ctx, &livekitprotocol.DeleteRoomRequest{
		Room: RoomName(callID),
	})
	return err
}

func (s *Service) RemoveParticipant(ctx context.Context, callID, identity string) error {
	if s == nil || s.rooms == nil || strings.TrimSpace(identity) == "" {
		return nil
	}
	_, err := s.rooms.RemoveParticipant(ctx, &livekitprotocol.RoomParticipantIdentity{
		Room:     RoomName(callID),
		Identity: identity,
	})
	return err
}
