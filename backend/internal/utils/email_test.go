package utils

import (
	"strings"
	"testing"
)

func TestVerificationEmailUsesDitPathBranding(t *testing.T) {
	email := verificationEmail("learner@example.test", "123456")

	if email.Subject != "Verify your DitPath email" {
		t.Fatalf("subject = %q; want DitPath branding", email.Subject)
	}
	if !strings.Contains(email.Text, "verify your DitPath email") {
		t.Fatalf("body = %q; want DitPath branding", email.Text)
	}
	if strings.Contains(strings.ToLower(email.Subject+email.Text), "opencw") {
		t.Fatalf("verification email still contains legacy branding: %q", email.Subject+email.Text)
	}
	if len(email.To) != 1 || email.To[0] != "learner@example.test" {
		t.Fatalf("recipients = %v; want the requested learner", email.To)
	}
}
