package models

type User struct {
	ID   uint   `json:"id" gorm:"primarykey"`
	Name string `json:"name"`
}

func (User) TableName() string {
	return "users"
}
