package dto

const (
	NotificationTypePostLiked      = "post_liked"
	NotificationTypeCommentCreated = "comment_created"
	NotificationTypeFriendRequest  = "friend_request"
	NotificationTypeFriendAccepted = "friend_accepted"
	NotificationTypeMessage        = "message_received"
	NotificationTypeIncomingCall   = "incoming_call"
)

type CreateNotificationReq struct {
	Action      string `json:"action,omitempty"`
	RecipientID uint   `json:"recipient_id"`
	ActorID     uint   `json:"actor_id"`
	Type        string `json:"type"`
	EntityID    uint   `json:"entity_id"`
	// CallID and ConversationID are populated for incoming_call.
	// ConversationID is the peer user id (from the recipient's point of view, the person to open chat with).
	CallID         string `json:"call_id,omitempty"`
	ConversationID uint   `json:"conversation_id,omitempty"`
}

type MarkNotificationsReadReq struct {
	Types          []string `json:"types"`
	ActorID        *uint    `json:"actor_id,omitempty"`
	EntityID       *uint    `json:"entity_id,omitempty"`
	ConversationID *uint    `json:"conversation_id,omitempty"`
}

type MarkNotificationsSeenReq struct {
	IDs []uint `json:"ids"`
}
