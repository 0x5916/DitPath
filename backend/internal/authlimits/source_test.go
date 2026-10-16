package authlimits

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

type testTransportAddress string

func (address testTransportAddress) Network() string { return string(address) }
func (address testTransportAddress) String() string  { return "test-only" }

func sourceRequest(remote string, forwarded ...string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
	request.RemoteAddr = remote
	for _, value := range forwarded {
		request.Header.Add("X-Forwarded-For", value)
	}
	return request
}

func TestTrustedProxyCIDRParsing(t *testing.T) {
	for _, test := range []struct {
		name string
		raw  string
		want []string
	}{{"unset", "", nil}, {"blank", "  ", nil}, {"canonical", " 192.0.2.7/24, 2001:db8::7/64 ", []string{"192.0.2.0/24", "2001:db8::/64"}}, {"mapped", "::ffff:192.0.2.7/120", []string{"192.0.2.0/24"}}} {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseTrustedProxies(test.raw)
			if err != nil || len(got) != len(test.want) {
				t.Fatalf("parse = %v, %v", got, err)
			}
			for i, expected := range test.want {
				if got[i].String() != expected {
					t.Fatalf("prefix %d = %s, want %s", i, got[i], expected)
				}
			}
		})
	}
	for _, raw := range []string{"0.0.0.0/0", "::/0", "::ffff:0.0.0.0/96", "invalid", "192.0.2.1", "192.0.2.0/33", "192.0.2.0/24,", ",192.0.2.0/24", "192.0.2.0/24,,198.51.100.0/24", "fe80::1%en0/64"} {
		t.Run("reject_"+raw, func(t *testing.T) {
			if _, err := ParseTrustedProxies(raw); err == nil {
				t.Fatal("unsafe or malformed CIDR accepted")
			}
		})
	}
}

func TestDirectPeerCanonicalizationAndIgnoredHeaders(t *testing.T) {
	for _, test := range []struct {
		name string
		peer string
		want string
	}{{"IPv4", "192.0.2.1:1000", "192.0.2.1"}, {"port_alias", "192.0.2.1:2000", "192.0.2.1"}, {"mapped", "[::ffff:192.0.2.1]:1000", "192.0.2.1"}, {"IPv6", "[2001:0db8:0:0::1]:1000", "2001:db8::1"}, {"zone", "[fe80::1%en0]:1000", "fe80::1"}, {"zone_alias", "[fe80::1%en1]:2000", "fe80::1"}} {
		t.Run(test.name, func(t *testing.T) {
			request := sourceRequest(test.peer, "203.0.113.1", "malformed")
			request.Header.Set("X-Real-IP", "203.0.113.2")
			request.Header.Set("CF-Connecting-IP", "203.0.113.3")
			request.Header.Set("X-Appengine-Remote-Addr", "203.0.113.4")
			for _, trusted := range [][]netip.Prefix{nil, {netip.MustParsePrefix("198.51.100.0/24")}} {
				got, err := ResolveSource(request, trusted)
				if err != nil || got.String() != test.want {
					t.Fatalf("source = %v, %v; want %s", got, err, test.want)
				}
			}
		})
	}
}

func TestTrustedForwardingSelectsClosestUntrustedHop(t *testing.T) {
	trusted, err := ParseTrustedProxies("192.0.2.0/24,198.51.100.0/24,2001:db8::/64")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		peer   string
		fields []string
		want   string
	}{
		{"one_proxy", "192.0.2.1:1000", []string{"203.0.113.1"}, "203.0.113.1"},
		{"closest_untrusted", "192.0.2.1:1000", []string{"203.0.113.1,203.0.113.2,198.51.100.1"}, "203.0.113.2"},
		{"repeated_fields_order", "192.0.2.1:1000", []string{"203.0.113.1, 203.0.113.2", " 198.51.100.1 ,192.0.2.2 "}, "203.0.113.2"},
		{"all_trusted_leftmost", "192.0.2.1:1000", []string{"198.51.100.2", "192.0.2.2"}, "198.51.100.2"},
		{"mapped_peer_and_chain", "[::ffff:192.0.2.1]:1000", []string{"::ffff:203.0.113.1,::ffff:198.51.100.1"}, "203.0.113.1"},
		{"IPv6", "[2001:db8::1]:1000", []string{"2001:db9::1,2001:db8::2"}, "2001:db9::1"},
		{"forwarded_zone_removed", "192.0.2.1:1000", []string{"fe80::1%en0"}, "fe80::1"},
		{"missing_forwarded", "192.0.2.1:1000", nil, "192.0.2.1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := sourceRequest(test.peer, test.fields...)
			request.Header.Set("X-Real-IP", "203.0.113.100")
			request.Header.Set("CF-Connecting-IP", "203.0.113.101")
			request.Header.Set("X-Appengine-Remote-Addr", "203.0.113.102")
			got, err := ResolveSource(request, trusted)
			if err != nil || got.String() != test.want {
				t.Fatalf("source = %v, %v; want %s", got, err, test.want)
			}
		})
	}
}

func TestEveryForwardingElementMustBeValid(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24")}
	for _, fields := range [][]string{{"malformed,203.0.113.1"}, {"203.0.113.1,malformed"}, {"malformed", "203.0.113.1,192.0.2.2"}, {"203.0.113.1", "malformed"}, {"203.0.113.1,,192.0.2.2"}, {"", "203.0.113.1"}, {"203.0.113.1,"}, {",203.0.113.1"}, {"203.0.113.1:80"}, {"[2001:db9::1]:80"}, {"unknown"}} {
		t.Run(fields[0], func(t *testing.T) {
			got, err := ResolveSource(sourceRequest("192.0.2.1:1000", fields...), trusted)
			if err != nil || got.String() != "192.0.2.1" {
				t.Fatalf("malformed chain source = %v, %v", got, err)
			}
		})
	}
}

func TestMalformedOrUnsupportedTransportCannotUseHeaders(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("192.0.2.0/24")}
	for _, peer := range []string{"", "192.0.2.1", "host.example:1000", "/tmp/api.sock", "malformed", "[2001:db8::1]", "192.0.2.1:abc", "192.0.2.1:65536", "192.0.2.1:", "0.0.0.0:1000", "[::]:1000", "[::ffff:0.0.0.0]:1000"} {
		t.Run(peer, func(t *testing.T) {
			if got, err := ResolveSource(sourceRequest(peer, "203.0.113.1"), trusted); err == nil || got.IsValid() {
				t.Fatalf("invalid transport accepted: %v, %v", got, err)
			}
		})
	}
	for _, network := range []string{"unix", "unixpacket", "udp", "udp4"} {
		t.Run(network, func(t *testing.T) {
			request := sourceRequest("192.0.2.1:1000", "203.0.113.1")
			request = request.WithContext(context.WithValue(request.Context(), http.LocalAddrContextKey, testTransportAddress(network)))
			if got, err := ResolveSource(request, trusted); err == nil || got.IsValid() {
				t.Fatalf("unsupported transport accepted: %v, %v", got, err)
			}
		})
	}
	for _, network := range []string{"tcp", "tcp4", "tcp6"} {
		t.Run(network, func(t *testing.T) {
			request := sourceRequest("192.0.2.1:1000", "203.0.113.1")
			request = request.WithContext(context.WithValue(request.Context(), http.LocalAddrContextKey, testTransportAddress(network)))
			if got, err := ResolveSource(request, trusted); err != nil || got.String() != "203.0.113.1" {
				t.Fatalf("TCP transport rejected: %v, %v", got, err)
			}
		})
	}
}

func TestMappedTrustedProxyPrefixMatchesCanonicalPeer(t *testing.T) {
	trusted, err := ParseTrustedProxies("::ffff:192.0.2.0/120")
	if err != nil {
		t.Fatal(err)
	}
	for _, peer := range []string{"192.0.2.1:1000", "[::ffff:192.0.2.1]:1000"} {
		got, err := ResolveSource(sourceRequest(peer, "203.0.113.1"), trusted)
		if err != nil || got.String() != "203.0.113.1" {
			t.Fatalf("mapped allowlist/source mismatch: %v, %v", got, err)
		}
	}
}
