package configs

import (
	"fmt"
	"net/mail"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

type OwnerMail struct {
	Enabled        bool
	ReplyTo        string
	Footer         string
	UnsubscribeURL string
}

func (c Config) validateOwnerMail() error {
	m := c.OwnerMail
	if !m.Enabled {
		return nil
	}
	if c.AdminUserID == uuid.Nil || strings.TrimSpace(m.Footer) == "" || len(m.Footer) > 2048 {
		return fmt.Errorf("enabled owner email requires ADMIN_USER_ID and a sender footer of up to 2048 bytes")
	}
	for _, address := range []string{c.ResendFromEmail, m.ReplyTo} {
		if _, err := mail.ParseAddress(address); err != nil || strings.ContainsAny(address, "\r\n") || len(address) > 512 {
			return fmt.Errorf("enabled owner email requires a valid sender and reply mailbox")
		}
	}
	u, err := url.Parse(m.UnsubscribeURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || len(m.UnsubscribeURL) > 2048 || strings.ContainsAny(m.UnsubscribeURL, "#<>\r\n ") {
		return fmt.Errorf("OWNER_EMAIL_UNSUBSCRIBE_URL must be a public HTTPS endpoint without a query or fragment")
	}
	return nil
}
