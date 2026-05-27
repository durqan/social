package dto

type CreateNotificationReq struct {
	RecipientID uint   `json:"recipient_id"`
	ActorID     uint   `json:"actor_id"`
	Type        string `json:"type"`
	EntityID    uint   `json:"entity_id"`
}
