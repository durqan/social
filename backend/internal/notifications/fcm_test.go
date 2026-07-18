package notifications

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"tester/internal/models"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestFCMSendClassifiesInvalidToken(t *testing.T) {
	client := testFCMClient(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusNotFound,
			Body:       io.NopCloser(strings.NewReader(`{"error":{"status":"UNREGISTERED"}}`)),
			Header:     make(http.Header),
			Request:    request,
		}, nil
	})

	err := client.SendMobile(
		context.Background(),
		models.MobilePushToken{Token: "invalid"},
		Payload{Type: TypeMessage},
	)
	if !errors.Is(err, ErrMobileTokenInvalid) {
		t.Fatalf("SendMobile error = %v, want ErrMobileTokenInvalid", err)
	}
}

func TestFCMSendClassifiesRetryableAndPermanentResponses(t *testing.T) {
	for _, test := range []struct {
		name      string
		status    int
		permanent bool
	}{
		{name: "server error", status: http.StatusServiceUnavailable},
		{name: "rate limited", status: http.StatusTooManyRequests},
		{name: "bad payload", status: http.StatusBadRequest, permanent: true},
		{name: "project not found", status: http.StatusNotFound, permanent: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := testFCMClient(func(request *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: test.status,
					Body:       io.NopCloser(strings.NewReader(`{"error":"test"}`)),
					Header:     make(http.Header),
					Request:    request,
				}, nil
			})
			err := client.SendMobile(
				context.Background(),
				models.MobilePushToken{Token: "token"},
				Payload{Type: TypeFriendRequest},
			)
			if err == nil || isPermanentFCMError(err) != test.permanent {
				t.Fatalf("error = %v, permanent = %v", err, isPermanentFCMError(err))
			}
		})
	}
}

func TestFCMSendExposesRetryAfter(t *testing.T) {
	client := testFCMClient(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Body:       io.NopCloser(strings.NewReader(`{"error":"rate limited"}`)),
			Header:     http.Header{"Retry-After": []string{"120"}},
			Request:    request,
		}, nil
	})

	err := client.SendMobile(
		context.Background(),
		models.MobilePushToken{Token: "token"},
		Payload{Type: TypeFriendRequest},
	)
	if delay := RetryAfter(err); delay != 2*time.Minute {
		t.Fatalf("RetryAfter(error) = %s, want 2m", delay)
	}
}

func TestFCMVisibleAndSilentPayloadShape(t *testing.T) {
	var bodies []string
	client := testFCMClient(func(request *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		bodies = append(bodies, string(body))
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{}`)),
			Header:     make(http.Header),
			Request:    request,
		}, nil
	})

	token := models.MobilePushToken{Token: "token"}
	if err := client.SendMobile(
		context.Background(),
		token,
		Payload{Type: TypeMessage, Title: "Sender", Body: "Message"},
	); err != nil {
		t.Fatal(err)
	}
	if err := client.SendMobile(
		context.Background(),
		token,
		Payload{Type: "notification_sync", Silent: true},
	); err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 ||
		!strings.Contains(bodies[0], `"notification"`) ||
		strings.Contains(bodies[1], `"notification"`) {
		t.Fatalf("unexpected FCM request bodies: %v", bodies)
	}
}

func testFCMClient(transport roundTripFunc) *FCMClient {
	return &FCMClient{
		projectID: "project",
		httpClient: &http.Client{
			Transport: transport,
		},
		enabled: true,
	}
}
