package googleauth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testClientID = "123-test.apps.googleusercontent.com"

var nonce = base64.RawURLEncoding.EncodeToString(make([]byte, 32))
var keyOnce sync.Once
var signingKey *rsa.PrivateKey

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func privateKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	keyOnce.Do(func() {
		var err error
		signingKey, err = rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
	})
	return signingKey
}

func token(t *testing.T, now time.Time, mutate func(jwt.MapClaims), header func(map[string]any)) string {
	t.Helper()
	c := jwt.MapClaims{"iss": Issuer, "sub": "google-subject", "aud": testClientID,
		"iat": now.Add(-time.Minute).Unix(), "exp": now.Add(time.Hour).Unix(), "nonce": nonce,
		"email": "user@gmail.com", "email_verified": true, "hd": "example.com"}
	if mutate != nil {
		mutate(c)
	}
	value := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
	value.Header["kid"] = "current"
	if header != nil {
		header(value.Header)
	}
	raw, err := value.SignedString(privateKey(t))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func jwk(t *testing.T, id string) map[string]any {
	t.Helper()
	key := privateKey(t).PublicKey
	return map[string]any{"kty": "RSA", "kid": id, "alg": "RS256", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
		"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}
}

func keyBody(t *testing.T, keys ...map[string]any) string {
	t.Helper()
	data, err := json.Marshal(map[string]any{"keys": keys})
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func response(body, cache string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)),
		Header: http.Header{"Cache-Control": []string{cache}}}
}

func TestVerifierClaims(t *testing.T) {
	now := time.Unix(1800000000, 0)
	var requests atomic.Int32
	v := newVerifier(roundTripFunc(func(req *http.Request) (*http.Response, error) {
		requests.Add(1)
		if req.URL.String() != certURL || req.Method != "GET" {
			t.Errorf("unexpected key request %s %s", req.Method, req.URL)
		}
		return response(keyBody(t, jwk(t, "current")), "max-age=3600"), nil
	}), func() time.Time { return now })
	for _, issuer := range []string{Issuer, "accounts.google.com"} {
		identity, err := v.Verify(context.Background(), testClientID,
			token(t, now, func(c jwt.MapClaims) { c["iss"] = issuer; c["azp"] = testClientID }, func(h map[string]any) { h["jku"] = "https://attacker.invalid/keys" }), nonce)
		if err != nil || identity.Subject != "google-subject" || identity.Email != "user@gmail.com" || !identity.EmailVerified || identity.HostedDomain != "example.com" {
			t.Fatalf("valid identity = %+v, %v", identity, err)
		}
	}
	cases := map[string]func(jwt.MapClaims){
		"wrong issuer":        func(c jwt.MapClaims) { c["iss"] = "https://attacker.invalid" },
		"wrong audience":      func(c jwt.MapClaims) { c["aud"] = "another-client" },
		"missing audience":    func(c jwt.MapClaims) { delete(c, "aud") },
		"expired":             func(c jwt.MapClaims) { c["exp"] = now.Unix() },
		"missing expiry":      func(c jwt.MapClaims) { delete(c, "exp") },
		"missing issued at":   func(c jwt.MapClaims) { delete(c, "iat") },
		"future issued at":    func(c jwt.MapClaims) { c["iat"] = now.Add(61 * time.Second).Unix() },
		"invalid issued at":   func(c jwt.MapClaims) { c["iat"] = 0 },
		"issued after expiry": func(c jwt.MapClaims) { c["iat"] = now.Add(time.Hour).Unix() },
		"missing subject":     func(c jwt.MapClaims) { delete(c, "sub") },
		"empty subject":       func(c jwt.MapClaims) { c["sub"] = "  " },
		"oversized subject":   func(c jwt.MapClaims) { c["sub"] = strings.Repeat("s", 256) },
		"wrong nonce":         func(c jwt.MapClaims) { c["nonce"] = "another-nonce" },
		"missing nonce":       func(c jwt.MapClaims) { delete(c, "nonce") },
		"wrong authorized":    func(c jwt.MapClaims) { c["azp"] = "another-client" },
		"empty authorized":    func(c jwt.MapClaims) { c["azp"] = "" },
		"null authorized":     func(c jwt.MapClaims) { c["azp"] = nil },
		"oversized email":     func(c jwt.MapClaims) { c["email"] = strings.Repeat("e", 255) },
		"malformed email":     func(c jwt.MapClaims) { c["email"] = "Person <user@gmail.com>" },
		"oversized domain":    func(c jwt.MapClaims) { c["hd"] = strings.Repeat("d", 254) },
		"wrong verified type": func(c jwt.MapClaims) { c["email_verified"] = "true" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(context.Background(), testClientID, token(t, now, mutate, nil), nonce); !errors.Is(err, ErrInvalidCredential) {
				t.Fatalf("got %v", err)
			}
		})
	}
	for name, header := range map[string]func(map[string]any){
		"missing kid":   func(h map[string]any) { delete(h, "kid") },
		"oversized kid": func(h map[string]any) { h["kid"] = strings.Repeat("k", 129) },
		"invalid kid":   func(h map[string]any) { h["kid"] = 42 },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(context.Background(), testClientID, token(t, now, nil, header), nonce); !errors.Is(err, ErrInvalidCredential) {
				t.Fatalf("got %v", err)
			}
		})
	}
	valid := token(t, now, nil, nil)
	for name, value := range map[string]string{"empty": "", "malformed": "not-a-jwt", "oversized": strings.Repeat("x", 12*1024+1)} {
		t.Run(name, func(t *testing.T) {
			if _, err := v.Verify(context.Background(), testClientID, value, nonce); !errors.Is(err, ErrInvalidCredential) {
				t.Fatalf("got %v", err)
			}
		})
	}
	if _, err := v.Verify(context.Background(), testClientID, valid, "short"); !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("short nonce: %v", err)
	}
	if _, err := v.Verify(context.Background(), "", valid, nonce); !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("empty configured client: %v", err)
	}
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _, _ := new(jwt.Parser).ParseUnverified(valid, jwt.MapClaims{})
	badSignature, _ := parsed.SignedString(other)
	if _, err := v.Verify(context.Background(), testClientID, badSignature, nonce); !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("bad signature: %v", err)
	}
	wrongMethod, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, parsed.Claims).SignedString([]byte("secret"))
	if _, err := v.Verify(context.Background(), testClientID, wrongMethod, nonce); !errors.Is(err, ErrInvalidCredential) {
		t.Fatalf("wrong algorithm: %v", err)
	}
	if requests.Load() != 1 || len(v.active) != 0 {
		t.Fatalf("requests=%d, leaked verifications=%d", requests.Load(), len(v.active))
	}
}

func TestVerifierKeyFailures(t *testing.T) {
	now := time.Unix(1800000000, 0)
	valid := token(t, now, nil, nil)
	bodies := map[string]string{"invalid JSON": "{", "oversized response": strings.Repeat(" ", 64*1024+1), "empty keys": `{"keys":[]}`}
	for field, value := range map[string]any{"kty": "EC", "alg": "HS256", "use": "enc", "kid": "", "n": "invalid", "e": "Ag"} {
		key := jwk(t, "current")
		key[field] = value
		bodies["invalid "+field] = keyBody(t, key)
	}
	bodies["duplicate keys"] = keyBody(t, jwk(t, "current"), jwk(t, "current"))
	var many []map[string]any
	for i := range 17 {
		many = append(many, jwk(t, fmt.Sprintf("key-%d", i)))
	}
	bodies["too many keys"] = keyBody(t, many...)
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			v := newVerifier(roundTripFunc(func(*http.Request) (*http.Response, error) { return response(body, "max-age=3600"), nil }), func() time.Time { return now })
			if _, err := v.Verify(context.Background(), testClientID, valid, nonce); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("got %v", err)
			}
		})
	}
	for _, status := range []int{302, 500} {
		t.Run(fmt.Sprintf("status %d", status), func(t *testing.T) {
			var count int
			v := newVerifier(roundTripFunc(func(req *http.Request) (*http.Response, error) {
				count++
				if req.URL.String() != certURL {
					t.Fatal("followed a redirect")
				}
				r := response("", "max-age=3600")
				r.StatusCode = status
				r.Header.Set("Location", "https://attacker.invalid/keys")
				return r, nil
			}), func() time.Time { return now })
			if _, err := v.Verify(context.Background(), testClientID, valid, nonce); !errors.Is(err, ErrUnavailable) || count != 1 {
				t.Fatalf("err=%v requests=%d", err, count)
			}
		})
	}
	var count int
	v := newVerifier(roundTripFunc(func(req *http.Request) (*http.Response, error) {
		count++
		deadline, ok := req.Context().Deadline()
		if !ok || time.Until(deadline) > 3*time.Second {
			t.Fatal("key request lacks bounded timeout")
		}
		return nil, context.DeadlineExceeded
	}), func() time.Time { return now })
	for range 2 {
		if _, err := v.Verify(context.Background(), testClientID, valid, nonce); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("fetch failure: %v", err)
		}
	}
	if count != 1 {
		t.Fatalf("failed fetch cooldown: %d requests", count)
	}
}

func TestVerifierCacheRotation(t *testing.T) {
	now := time.Unix(1800000000, 0)
	var count int
	current := "current"
	fail := false
	v := newVerifier(roundTripFunc(func(*http.Request) (*http.Response, error) {
		count++
		if fail {
			return nil, errors.New("offline")
		}
		return response(keyBody(t, jwk(t, current)), "max-age=3600"), nil
	}), func() time.Time { return now })
	verify := func(kid string, want error) {
		t.Helper()
		_, err := v.Verify(context.Background(), testClientID, token(t, now, nil, func(h map[string]any) { h["kid"] = kid }), nonce)
		if !errors.Is(err, want) {
			t.Fatalf("kid %q: got %v, want %v", kid, err, want)
		}
	}
	verify("current", nil)
	verify("current", nil)
	current = "rotated"
	verify("rotated", ErrUnavailable)
	if count != 1 {
		t.Fatalf("cooldown requests=%d", count)
	}
	now = now.Add(time.Minute)
	verify("rotated", nil)
	now = now.Add(time.Minute)
	verify("missing", ErrInvalidCredential)
	fail = true
	now = now.Add(time.Hour)
	verify("rotated", ErrUnavailable)
	verify("rotated", ErrUnavailable)
	if count != 4 {
		t.Fatalf("rotation/outage requests=%d", count)
	}
	fail = false
	now = now.Add(time.Minute)
	verify("rotated", nil)
	if count != 5 {
		t.Fatalf("recovery requests=%d", count)
	}
}

func TestVerifierUncachedKeys(t *testing.T) {
	now := time.Unix(1800000000, 0)
	var count int
	v := newVerifier(roundTripFunc(func(*http.Request) (*http.Response, error) {
		count++
		return response(keyBody(t, jwk(t, "current")), "invalid"), nil
	}), func() time.Time { return now })
	valid := token(t, now, nil, nil)
	if _, err := v.Verify(context.Background(), testClientID, valid, nonce); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Verify(context.Background(), testClientID, valid, nonce); !errors.Is(err, ErrUnavailable) || count != 1 {
		t.Fatalf("uncached result reused: %v, requests=%d", err, count)
	}
}

func TestVerifierConcurrencyAndCancellation(t *testing.T) {
	now := time.Unix(1800000000, 0)
	valid := token(t, now, nil, nil)
	started, release := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	v := newVerifier(roundTripFunc(func(*http.Request) (*http.Response, error) {
		count.Add(1)
		close(started)
		<-release
		return response(keyBody(t, jwk(t, "current")), "max-age=3600"), nil
	}), func() time.Time { return now })
	results := make(chan error, 3)
	go func() { _, err := v.Verify(context.Background(), testClientID, valid, nonce); results <- err }()
	<-started
	for range 2 {
		go func() { _, err := v.Verify(context.Background(), testClientID, valid, nonce); results <- err }()
	}
	ctx, cancel := context.WithCancel(context.Background())
	canceled := make(chan error, 1)
	go func() { _, err := v.Verify(ctx, testClientID, valid, nonce); canceled <- err }()
	deadline := time.Now().Add(3 * time.Second)
	for len(v.active) != 4 && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	if len(v.active) != 4 {
		close(release)
		t.Fatal("four verifications did not enter")
	}
	if _, err := v.Verify(context.Background(), testClientID, valid, nonce); !errors.Is(err, ErrUnavailable) {
		t.Errorf("fifth verification: %v", err)
	}
	cancel()
	if err := <-canceled; !errors.Is(err, context.Canceled) {
		t.Errorf("canceled waiter: %v", err)
	}
	close(release)
	for range 3 {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
	if count.Load() != 1 || len(v.active) != 0 {
		t.Fatalf("refreshes=%d remaining=%d", count.Load(), len(v.active))
	}
	if _, err := v.Verify(ctx, testClientID, valid, nonce); !errors.Is(err, context.Canceled) || len(v.active) != 0 {
		t.Fatalf("pre-canceled request: %v", err)
	}
}

func TestFreshness(t *testing.T) {
	now := time.Unix(1800000000, 0)
	for _, tc := range []struct {
		control, age string
		want         time.Duration
	}{
		{"max-age=3600", "", time.Hour}, {"max-age=999999", "", 24 * time.Hour},
		{"max-age=3600", "3600", 0}, {"max-age=3600", "30", time.Hour - 30*time.Second},
		{"max-age=3600", "bad", 0}, {"max-age=bad", "", 0}, {"max-age=3600, no-store", "", 0},
		{"max-age=3600, no-cache", "", 0}, {"", "", 0},
	} {
		t.Run(tc.control+"/"+tc.age, func(t *testing.T) {
			header := http.Header{"Cache-Control": []string{tc.control}, "Age": []string{tc.age}}
			if got := freshness(header, now); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
	date := now.Add(-time.Hour).UTC().Format("Mon, 02 Jan 2006 15:04:05 GMT")
	if parsed, err := http.ParseTime(date); err != nil || now.Sub(parsed) != time.Hour {
		t.Fatalf("test date %q: %v, %v", date, parsed, err)
	}
	if got := freshness(http.Header{"Cache-Control": []string{"max-age=3600"}, "Date": []string{date}}, now); got != 0 {
		t.Fatalf("stale upstream Date: %v", got)
	}
}
