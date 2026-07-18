package dto

type MobilePushTokenReq struct {
	UserID   uint   `json:"user_id"`
	Provider string `json:"provider" binding:"required"`
	Platform string `json:"platform" binding:"required"`
	Token    string `json:"token" binding:"required"`
}
