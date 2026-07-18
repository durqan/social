package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"tester/internal/dto"
)

const notificationDeliveryTimeout = 5 * time.Second

type notificationClient struct {
	endpoint string
	token    string
	client   *http.Client
}

func newNotificationClient(baseURL, token string) (*notificationClient, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" {
		return nil, errors.New("notifications internal URL is not configured")
	}
	if token == "" {
		return nil, errors.New("notifications internal token is not configured")
	}

	return &notificationClient{
		endpoint: baseURL + "/notifications",
		token:    token,
		client:   &http.Client{Timeout: notificationDeliveryTimeout},
	}, nil
}

func (c *notificationClient) deliver(ctx context.Context, req dto.CreateNotificationReq) error {
	body, err := json.Marshal(req)
	if err != nil {
		return err
	}

	requestCtx, cancel := context.WithTimeout(ctx, notificationDeliveryTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Internal-Token", c.token)

	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil
	}

	responseBody, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	message := strings.TrimSpace(string(responseBody))
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return fmt.Errorf("notifications service returned %d: %s", response.StatusCode, message)
}
