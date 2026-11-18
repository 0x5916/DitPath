package configs

import (
	"testing"

	"github.com/google/uuid"
)

func TestOwnerMailRequiresCompleteOptInConfig(t *testing.T) {
	base := validDirectConfig()
	if base.OwnerMail.Enabled {
		t.Fatal("custom sending must default off")
	}
	base.AdminUserID = uuid.New()
	base.OwnerMail = OwnerMail{Enabled: true, ReplyTo: "Support <support@example.invalid>", Footer: "Morsewell, Example Street", UnsubscribeURL: "https://api.example.invalid/v1/email/unsubscribe"}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	invalid := map[string]func(*Config){
		"missing owner":            func(c *Config) { c.AdminUserID = uuid.Nil },
		"missing sender identity":  func(c *Config) { c.OwnerMail.Footer = " " },
		"malformed reply mailbox":  func(c *Config) { c.OwnerMail.ReplyTo = "broken" },
		"reply injection":          func(c *Config) { c.OwnerMail.ReplyTo = "one@example.invalid\r\nBcc: second@example.invalid" },
		"insecure unsubscribe URL": func(c *Config) { c.OwnerMail.UnsubscribeURL = "http://example.invalid/unsubscribe" },
		"query in unsubscribe URL": func(c *Config) { c.OwnerMail.UnsubscribeURL += "?" },
	}
	for name, change := range invalid {
		t.Run(name, func(t *testing.T) {
			c := base
			change(&c)
			if c.Validate() == nil {
				t.Fatal("accepted invalid custom sending configuration")
			}
		})
	}
}
