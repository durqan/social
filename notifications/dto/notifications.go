package dto

const (
	NotificationTypePostLiked      = "post_liked"
	NotificationTypeCommentCreated = "comment_created"
	NotificationTypeFriendRequest  = "friend_request"
	NotificationTypeFriendAccepted = "friend_accepted"
	NotificationTypeMessage        = "message_received"
)

type CreateNotificationReq struct {
	RecipientID uint   `json:"recipient_id"`
	ActorID     uint   `json:"actor_id"`
	Type        string `json:"type"`
	EntityID    uint   `json:"entity_id"`
}

type MarkNotificationsReadReq struct {
	Types    []string `json:"types"`
	ActorID  *uint    `json:"actor_id,omitempty"`
	EntityID *uint    `json:"entity_id,omitempty"`
}
