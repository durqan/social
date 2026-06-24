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
	// CallID and ConversationID are used for incoming_call notifications.
	// They allow the notifications service and clients to route and de-duplicate call invites.
	CallID         string `json:"call_id,omitempty"`
	ConversationID uint   `json:"conversation_id,omitempty"`
	CallType       string `json:"call_type,omitempty"`
}
