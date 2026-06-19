package dto

type PushSubscriptionKeys struct {
	P256DH string `json:"p256dh" binding:"required"`
	Auth   string `json:"auth" binding:"required"`
}

type PushSubscriptionReq struct {
	UserID   uint                 `json:"user_id"`
	Endpoint string               `json:"endpoint" binding:"required"`
	Keys     PushSubscriptionKeys `json:"keys" binding:"required"`
}

type DeletePushSubscriptionReq struct {
	Endpoint string `json:"endpoint" binding:"required"`
}

type MobilePushTokenReq struct {
	UserID   uint   `json:"user_id"`
	Provider string `json:"provider" binding:"required"`
	Platform string `json:"platform" binding:"required"`
	Token    string `json:"token" binding:"required"`
}
