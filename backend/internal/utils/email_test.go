package utils

import (
	"strings"
	"testing"
)

func TestVerificationEmailUsesMorsewellBranding(t *testing.T) {
	email := verificationEmail("learner@example.test", "123456")

	if email.Subject != "Verify your Morsewell email" {
		t.Fatalf("subject = %q; want Morsewell branding", email.Subject)
	}
	if !strings.Contains(email.Text, "verify your Morsewell email") {
		t.Fatalf("body = %q; want Morsewell branding", email.Text)
	}
	if !strings.Contains(email.Text, "\n123456\n") || !strings.HasSuffix(email.Text, "Morsewell — Learn the code. Communicate well.") {
		t.Fatal("verification email must include the requested code and Morsewell signature")
	}
	if len(email.To) != 1 || email.To[0] != "learner@example.test" {
		t.Fatalf("recipients = %v; want the requested learner", email.To)
	}
}
