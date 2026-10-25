package configs

import "testing"

func TestGoogleConfigurationAndOrigins(t *testing.T) {
	for _, origin := range []string{"https://opencw.net", "https://app.example.invalid:8443", "http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"} {
		t.Run(origin, func(t *testing.T) {
			c := validDirectConfig()
			c.GoogleClientID = "123-test.apps.googleusercontent.com"
			c.CORSOrigins = []string{origin}
			if err := c.Validate(); err != nil || !c.GoogleOriginAllowed(origin) || c.GoogleOriginAllowed("https://untrusted.invalid") {
				t.Fatalf("configured origin validation/allowlist failed: %v", err)
			}
		})
	}
	for _, origin := range []string{"", "null", "*", "https://*.example.com", "https://app.example/", "https://app.example?", "https://app.example#", "https://user:pass@app.example", "http://192.168.1.2:3000", "https://app.example:bad", "https://app.example\n"} {
		t.Run("reject "+origin, func(t *testing.T) {
			c := validDirectConfig()
			c.GoogleClientID = "123-test.apps.googleusercontent.com"
			c.CORSOrigins = []string{origin}
			if c.Validate() == nil || c.GoogleOriginAllowed(origin) {
				t.Fatal("unsafe origin accepted")
			}
		})
	}
	c := validDirectConfig()
	if !c.GoogleOriginAllowed("https://opencw.net") || c.GoogleOriginAllowed("http://localhost:5173") {
		t.Fatal("development inherited an unconfigured origin")
	}
	for _, clientID := range []string{"invalid", " ", "123-test.apps.googleusercontent.com/", "test.apps.googleusercontent.com"} {
		c.GoogleClientID = clientID
		if c.Validate() == nil {
			t.Fatalf("invalid client ID accepted: %q", clientID)
		}
	}
	c.GoogleClientID, c.CORSOrigins = "", []string{"*"}
	if err := c.Validate(); err != nil {
		t.Fatalf("disabled Google changed existing config: %v", err)
	}
}
