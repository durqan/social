package services

import (
	"context"
	"testing"

	"tester/internal/models"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestLoadPendingVideoImportJobsOnlyReturnsImportingPreviews(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&models.MessageLinkPreview{}); err != nil {
		t.Fatal(err)
	}
	previews := []models.MessageLinkPreview{
		{MessageID: 10, OriginalURL: "https://example.com/ready", Provider: "youtube", Status: models.LinkPreviewStatusReady},
		{MessageID: 20, OriginalURL: "https://example.com/importing", Provider: "youtube", Status: models.LinkPreviewStatusImporting},
	}
	if err := database.Create(&previews).Error; err != nil {
		t.Fatal(err)
	}

	jobs, err := loadPendingVideoImportJobs(context.Background(), database, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 || jobs[0].LinkPreviewID != previews[1].ID || jobs[0].JobID == "" {
		t.Fatalf("jobs = %+v, want one durable importing preview", jobs)
	}
}
