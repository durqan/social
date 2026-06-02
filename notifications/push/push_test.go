package push

import "testing"

func TestNormalizeVAPIDSubject(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		want    string
	}{
		{
			name:    "bare email",
			subject: "admin@example.com",
			want:    "admin@example.com",
		},
		{
			name:    "mailto email",
			subject: "mailto:admin@example.com",
			want:    "admin@example.com",
		},
		{
			name:    "mailto email with angle brackets",
			subject: "mailto:<admin@example.com>",
			want:    "admin@example.com",
		},
		{
			name:    "https url",
			subject: "https://example.com/contact",
			want:    "https://example.com/contact",
		},
		{
			name:    "uppercase https scheme",
			subject: "HTTPS://example.com/contact",
			want:    "https://example.com/contact",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeVAPIDSubject(tt.subject)
			if got != tt.want {
				t.Fatalf("normalizeVAPIDSubject(%q) = %q, want %q", tt.subject, got, tt.want)
			}
		})
	}
}
