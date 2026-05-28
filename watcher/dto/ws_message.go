package dto

type WSMessageType string

const (
	WSMessageTypeMessage WSMessageType = "message"
	WSMessageTypePlay    WSMessageType = "play"
	WSMessageTypePause   WSMessageType = "pause"
	WSMessageTypeSeek    WSMessageType = "seek"
	WSMessageTypeSync    WSMessageType = "sync"
)

var allowedWSMessageTypes = map[WSMessageType]bool{
	WSMessageTypeMessage: true,
	WSMessageTypePlay:    true,
	WSMessageTypePause:   true,
	WSMessageTypeSeek:    true,
}

type WSMessage struct {
	Type   WSMessageType `json:"type"`
	Time   float64       `json:"time,omitempty"`
	Text   string        `json:"text,omitempty"`
	Paused bool          `json:"paused,omitempty"`
}

func IsAllowedWSMessageType(t WSMessageType) bool {
	return allowedWSMessageTypes[t]
}
