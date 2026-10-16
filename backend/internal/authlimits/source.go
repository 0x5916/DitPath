package authlimits

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

func ParseTrustedProxies(raw string) ([]netip.Prefix, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var prefixes []netip.Prefix
	for _, value := range strings.Split(raw, ",") {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil {
			return nil, fmt.Errorf("invalid AUTH_TRUSTED_PROXY_CIDRS: %w", err)
		}
		if prefix.Addr().Is4In6() {
			if prefix.Bits() <= 96 {
				return nil, fmt.Errorf("AUTH_TRUSTED_PROXY_CIDRS cannot trust all IPv4 peers")
			}
			prefix = netip.PrefixFrom(prefix.Addr().Unmap(), prefix.Bits()-96)
		}
		if prefix.Bits() == 0 {
			return nil, fmt.Errorf("AUTH_TRUSTED_PROXY_CIDRS cannot contain a /0 prefix")
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}

func trusted(address netip.Addr, proxies []netip.Prefix) bool {
	for _, proxy := range proxies {
		if proxy.Contains(address) {
			return true
		}
	}
	return false
}

func canonicalIP(value string) (netip.Addr, error) {
	address, err := netip.ParseAddr(value)
	if err != nil {
		return netip.Addr{}, ErrInvalidSource
	}
	address = address.Unmap().WithZone("")
	if address.IsUnspecified() {
		return netip.Addr{}, ErrInvalidSource
	}
	return address, nil
}

// ResolveSource deliberately does not use Gin's platform/proxy shortcuts.
func ResolveSource(request *http.Request, proxies []netip.Prefix) (netip.Addr, error) {
	if local, ok := request.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		switch local.Network() {
		case "tcp", "tcp4", "tcp6":
		default:
			return netip.Addr{}, ErrInvalidSource
		}
	}
	remote, err := netip.ParseAddrPort(strings.TrimSpace(request.RemoteAddr))
	if err != nil {
		return netip.Addr{}, ErrInvalidSource
	}
	peer, err := canonicalIP(remote.Addr().String())
	if err != nil || !trusted(peer, proxies) {
		return peer, err
	}
	values := request.Header.Values("X-Forwarded-For")
	if len(values) == 0 {
		return peer, nil
	}
	parts := strings.Split(strings.Join(values, ","), ",")
	chain := make([]netip.Addr, 0, len(parts))
	for _, part := range parts {
		address, err := canonicalIP(strings.TrimSpace(part))
		if err != nil {
			return peer, nil
		}
		chain = append(chain, address)
	}
	for i := len(chain) - 1; i >= 0; i-- {
		if i == 0 || !trusted(chain[i], proxies) {
			return chain[i], nil
		}
	}
	return peer, nil
}
