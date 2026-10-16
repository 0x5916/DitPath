package common

import (
	"github.com/google/uuid"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestReadPageRoundTrip(t *testing.T) {
	now := time.Date(2026, 10, 16, 1, 2, 3, 123456000, time.FixedZone("offset", 3600))
	id := uuid.New()
	page, err := ParseReadPage(url.Values{"limit": {"7"}, "cursor": {EncodeReadCursor(now, id)}})
	if err != nil || page.Limit != 7 || !page.Time.Equal(now) || page.ID != id || !page.HasCursor {
		t.Fatalf("round trip: %+v %v", page, err)
	}
	page, err = ParseReadPage(url.Values{})
	if err != nil || page.Limit != 100 || page.HasCursor {
		t.Fatalf("defaults: %+v %v", page, err)
	}
}
func TestReadPageRejectsMalformedParameters(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=-1", "limit=101", "limit=no", "limit=", "limit=1&limit=2", "cursor=", "cursor=no", "cursor=a&cursor=b", "cursor=" + strings.Repeat("a", 257)} {
		t.Run(query[:min(len(query), 40)], func(t *testing.T) {
			values, err := url.ParseQuery(query)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ParseReadPage(values); err == nil {
				t.Fatal("accepted invalid query")
			}
		})
	}
	for _, cursor := range []string{EncodeReadCursor(time.Now(), uuid.Nil), "MjAyNi0xMC0xNlQwMDowMDowMFp8YmFkLWlk"} {
		if _, err := ParseReadPage(url.Values{"cursor": {cursor}}); err == nil {
			t.Fatal("accepted invalid identity")
		}
	}
}
