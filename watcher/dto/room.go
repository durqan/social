package dto

type CreateRoomReq struct {
	VideoURL string `json:"video_url"`
}

type CreateRoomResp struct {
	RoomID   string `json:"room_id"`
	VideoURL string `json:"video_url"`
}

type RoomStatusResp struct {
	ClientCount int `json:"client_count"`
}
