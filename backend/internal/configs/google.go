package configs

import (
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

var googleClientIDPattern = regexp.MustCompile(`^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$`)

func (c Config) validateGoogle() error {
	if c.GoogleClientID == "" {
		return nil
	}
	if len(c.GoogleClientID) > 255 || !googleClientIDPattern.MatchString(c.GoogleClientID) {
		return fmt.Errorf("GOOGLE_CLIENT_ID must be a Google web client ID")
	}
	for _, origin := range c.CORSOrigins {
		if !validGoogleOrigin(origin) {
			return fmt.Errorf("CORS_ORIGINS must contain exact HTTPS or HTTP localhost origins when Google sign-in is enabled")
		}
	}
	return nil
}

// GoogleOriginAllowed never inherits the general development CORS allow-all.
func (c Config) GoogleOriginAllowed(origin string) bool {
	if !validGoogleOrigin(origin) {
		return false
	}
	if len(c.CORSOrigins) == 0 {
		return origin == "https://opencw.net"
	}
	for _, allowed := range c.CORSOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}

func validGoogleOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.Path != "" || strings.ContainsAny(origin, "?#*\\ \t\r\n") {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	address, _ := netip.ParseAddr(u.Hostname())
	return u.Scheme == "http" && (u.Hostname() == "localhost" || address.IsLoopback())
}
