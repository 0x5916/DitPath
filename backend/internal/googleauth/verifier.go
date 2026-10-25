// Package googleauth verifies Google identity credentials without storing them.
package googleauth

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const Issuer = "https://accounts.google.com"
const certURL = "https://www.googleapis.com/oauth2/v3/certs"

var (
	ErrInvalidCredential = errors.New("invalid Google credential")
	ErrUnavailable       = errors.New("Google verification unavailable")
)

type Identity struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
}

type claims struct {
	jwt.RegisteredClaims
	Nonce         string          `json:"nonce"`
	Authorized    json.RawMessage `json:"azp"`
	Email         string          `json:"email"`
	EmailVerified bool            `json:"email_verified"`
	HostedDomain  string          `json:"hd"`
}

type refresh struct {
	done chan struct{}
	keys map[string]*rsa.PublicKey
	err  error
}

type Verifier struct {
	client    *http.Client
	now       func() time.Time
	active    chan struct{}
	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	expires   time.Time
	lastFetch time.Time
	refresh   *refresh
}

var shared = NewVerifier()

func DefaultVerifier() *Verifier { return shared }

func NewVerifier() *Verifier { return newVerifier(http.DefaultTransport, time.Now) }

func newVerifier(transport http.RoundTripper, now func() time.Time) *Verifier {
	return &Verifier{client: &http.Client{Transport: transport, Timeout: 3 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		now: now, active: make(chan struct{}, 4)}
}

// Verify uses the server-configured client ID, never a value from a token/request.
func (v *Verifier) Verify(ctx context.Context, clientID, credential, nonce string) (Identity, error) {
	if err := ctx.Err(); err != nil {
		return Identity{}, err
	}
	rawNonce, err := base64.RawURLEncoding.DecodeString(nonce)
	if clientID == "" || credential == "" || len(credential) > 12*1024 || err != nil || len(rawNonce) != 32 || base64.RawURLEncoding.EncodeToString(rawNonce) != nonce {
		return Identity{}, ErrInvalidCredential
	}
	select {
	case v.active <- struct{}{}:
		defer func() { <-v.active }()
	default:
		return Identity{}, ErrUnavailable
	}
	c := &claims{}
	_, err = jwt.ParseWithClaims(credential, c, func(token *jwt.Token) (any, error) {
		kid, ok := token.Header["kid"].(string)
		if !ok || kid == "" || len(kid) > 128 || token.Method != jwt.SigningMethodRS256 {
			return nil, ErrInvalidCredential
		}
		return v.key(ctx, kid)
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithAudience(clientID), jwt.WithExpirationRequired(), jwt.WithTimeFunc(v.now))
	if ctx.Err() != nil {
		return Identity{}, ctx.Err()
	}
	if err != nil {
		if errors.Is(err, ErrUnavailable) {
			return Identity{}, ErrUnavailable
		}
		return Identity{}, ErrInvalidCredential
	}
	now := v.now()
	if (c.Issuer != Issuer && c.Issuer != "accounts.google.com") || strings.TrimSpace(c.Subject) == "" || len(c.Subject) > 255 || c.Nonce != nonce ||
		c.IssuedAt == nil || c.IssuedAt.Unix() <= 0 || c.IssuedAt.After(now.Add(time.Minute)) || !c.IssuedAt.Before(c.ExpiresAt.Time) ||
		len(c.Email) > 254 || len(c.HostedDomain) > 253 {
		return Identity{}, ErrInvalidCredential
	}
	if len(c.Authorized) != 0 {
		var authorized string
		if json.Unmarshal(c.Authorized, &authorized) != nil || authorized != clientID {
			return Identity{}, ErrInvalidCredential
		}
	}
	if c.Email != "" {
		address, err := mail.ParseAddress(c.Email)
		if err != nil || address.Address != c.Email {
			return Identity{}, ErrInvalidCredential
		}
	}
	return Identity{Subject: c.Subject, Email: c.Email, EmailVerified: c.EmailVerified, HostedDomain: c.HostedDomain}, nil
}

func (v *Verifier) key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	now := v.now()
	if key := v.keys[kid]; key != nil && now.Before(v.expires) {
		v.mu.Unlock()
		return key, nil
	}
	if pending := v.refresh; pending != nil {
		v.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-pending.done:
			return refreshedKey(pending, kid)
		}
	}
	if !v.lastFetch.IsZero() && now.Sub(v.lastFetch) < time.Minute {
		v.mu.Unlock()
		return nil, ErrUnavailable
	}
	pending := &refresh{done: make(chan struct{})}
	v.lastFetch, v.refresh = now, pending
	v.mu.Unlock()
	keys, ttl, err := v.fetch(ctx)
	v.mu.Lock()
	pending.keys, pending.err = keys, err
	if err == nil {
		v.keys, v.expires = keys, v.now().Add(ttl)
	}
	v.refresh = nil
	close(pending.done)
	v.mu.Unlock()
	return refreshedKey(pending, kid)
}

func refreshedKey(result *refresh, kid string) (*rsa.PublicKey, error) {
	if result.err != nil {
		return nil, ErrUnavailable
	}
	if key := result.keys[kid]; key != nil {
		return key, nil
	}
	return nil, ErrInvalidCredential
}

func (v *Verifier) fetch(ctx context.Context) (map[string]*rsa.PublicKey, time.Duration, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, certURL, nil)
	if err != nil {
		return nil, 0, err
	}
	response, err := v.client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, 0, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024+1))
	if err != nil || len(body) > 64*1024 {
		return nil, 0, ErrUnavailable
	}
	var set struct {
		Keys []struct {
			Type string `json:"kty"`
			ID   string `json:"kid"`
			Alg  string `json:"alg"`
			Use  string `json:"use"`
			N    string `json:"n"`
			E    string `json:"e"`
		} `json:"keys"`
	}
	if json.Unmarshal(body, &set) != nil || len(set.Keys) == 0 || len(set.Keys) > 16 {
		return nil, 0, ErrUnavailable
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, key := range set.Keys {
		n, nerr := base64.RawURLEncoding.DecodeString(key.N)
		e, eerr := base64.RawURLEncoding.DecodeString(key.E)
		modulus := new(big.Int).SetBytes(n)
		if key.Type != "RSA" || key.ID == "" || len(key.ID) > 128 || keys[key.ID] != nil || (key.Alg != "" && key.Alg != "RS256") ||
			(key.Use != "" && key.Use != "sig") || nerr != nil || eerr != nil || modulus.BitLen() < 2048 || modulus.BitLen() > 8192 || len(e) == 0 || len(e) > 4 {
			return nil, 0, ErrUnavailable
		}
		exponent := new(big.Int).SetBytes(e).Int64()
		if exponent < 3 || exponent > 1<<31-1 || exponent%2 == 0 {
			return nil, 0, ErrUnavailable
		}
		keys[key.ID] = &rsa.PublicKey{N: modulus, E: int(exponent)}
	}
	return keys, freshness(response.Header, v.now()), nil
}

func freshness(header http.Header, now time.Time) time.Duration {
	var ttl time.Duration
	for _, directive := range strings.Split(header.Get("Cache-Control"), ",") {
		name, value, _ := strings.Cut(strings.TrimSpace(directive), "=")
		switch strings.ToLower(name) {
		case "no-store", "no-cache":
			return 0
		case "max-age":
			seconds, err := strconv.ParseUint(strings.Trim(value, "\""), 10, 32)
			if err != nil {
				return 0
			}
			ttl = time.Duration(min(seconds, 86400)) * time.Second
		}
	}
	var age time.Duration
	if value := header.Get("Age"); value != "" {
		seconds, err := strconv.ParseUint(value, 10, 32)
		if err != nil {
			return 0
		}
		age = time.Duration(seconds) * time.Second
	}
	if date, err := http.ParseTime(header.Get("Date")); err == nil {
		age = max(age, now.Sub(date))
	}
	return max(0, ttl-age)
}
