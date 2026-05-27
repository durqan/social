package services

import (
	"notifications/dto"
	"notifications/hub"
	"notifications/models"
	"notifications/repository"
)

type Service struct {
	repo *repository.Repository
	hub  *hub.Hub
}

func NewService(repo *repository.Repository, hub *hub.Hub) *Service {
	return &Service{repo: repo, hub: hub}
}

func (s *Service) CreateNotification(req *dto.CreateNotificationReq) error {
	note := &models.Notification{
		RecipientID: req.RecipientID,
		ActorID:     req.ActorID,
		Type:        req.Type,
		EntityID:    req.EntityID,
	}

	if err := s.repo.Create(note); err != nil {
		return err
	}

	s.hub.SendToUser(note.RecipientID, *note)
	return nil
}

func (s *Service) GetUserNotifications(userID uint) ([]models.Notification, error) {
	return s.repo.FindByRecipientID(userID)
}

func (s *Service) MarkAsRead(id uint) error {
	return s.repo.MarkAsRead(id)
}
