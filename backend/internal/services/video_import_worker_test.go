package services

import (
	"context"
	"os"
	"path/filepath"
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

func TestTryQueueVideoImportJobIsBoundedAndCancellationAware(t *testing.T) {
	jobs := make(chan VideoImportJob, 1)
	first := VideoImportJob{LinkPreviewID: 1}
	if !tryQueueVideoImportJob(context.Background(), jobs, first) {
		t.Fatal("first job was not queued")
	}
	if tryQueueVideoImportJob(context.Background(), jobs, VideoImportJob{LinkPreviewID: 2}) {
		t.Fatal("job was queued past channel capacity")
	}

	<-jobs
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if tryQueueVideoImportJob(canceled, jobs, VideoImportJob{LinkPreviewID: 3}) {
		t.Fatal("job was queued after cancellation")
	}
}

func TestProcessVideoImportJobMarksTempPreparationFailure(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.AutoMigrate(&models.MessageLinkPreview{}); err != nil {
		t.Fatal(err)
	}
	preview := models.MessageLinkPreview{
		MessageID:   20,
		OriginalURL: "https://example.com/video",
		Provider:    "youtube",
		Status:      models.LinkPreviewStatusImporting,
	}
	if err := database.Create(&preview).Error; err != nil {
		t.Fatal(err)
	}

	tempRoot := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(tempRoot, []byte("file"), 0o600); err != nil {
		t.Fatal(err)
	}
	err = ProcessVideoImportJob(context.Background(), database, VideoImportWorkerConfig{
		TempRoot: tempRoot,
	}, VideoImportJob{
		JobID:         "test-job",
		MessageID:     preview.MessageID,
		LinkPreviewID: preview.ID,
		OriginalURL:   preview.OriginalURL,
		Provider:      preview.Provider,
	})
	if err == nil {
		t.Fatal("ProcessVideoImportJob error = nil, want temp preparation failure")
	}

	if err := database.First(&preview, preview.ID).Error; err != nil {
		t.Fatal(err)
	}
	if preview.Status != models.LinkPreviewStatusFailed || preview.ImportError == nil {
		t.Fatalf("preview = %+v, want failed status with import error", preview)
	}
}
